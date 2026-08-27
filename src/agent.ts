import { TrueForge, TrueForgeError } from '@truefoundry/trueforge-sdk';
import { AGENT_NAME, buildAgentSpec } from './agent-spec.js';
import { config, type AppConfig } from './config.js';
import { formatTokenomics, observeTurn, unwrapTurnEvent, type HarnessEvent, type TurnObservation } from './events.js';
import { checkTrueForge, createTrueForgeClient, describeTrueForgeError } from './harness.js';
import { ResilientModelRouter } from './model-router.js';
import { provisionHarness } from './provision.js';
import { fixtureFailurePrompt } from './fixture-prompt.js';
import { toHandoffPrompt, type CaseFile } from './case-file.js';
import { discoverModels, reconcileChain } from './model-catalog.js';
import { addUsage, evaluateBudget, readUsage, type Usage } from './tokenomics.js';
export interface TriageResult {
  sessionId: string;
  modelFqn: string;
  observation: TurnObservation;
  tokenomics: string;
  provisionNotes: string[];
}

export type EventListener = (event: HarnessEvent) => void;

export class CIFailureSurgeon {
  private readonly client: TrueForge;
  private readonly router: ResilientModelRouter;
  private provisionNotes: string[] = [];
  private provisioned = false;
  private usageAcc: Partial<Usage> = {};
  private caseFile: CaseFile = {
    repoUrl: 'fixture/auth-service',
    testCommand: 'node --test tests/token_verifier.test.mjs',
    stage: 'hunt',
  };

  constructor(
    private readonly cfg: AppConfig = config,
    private readonly onEvent: EventListener = () => undefined,
  ) {
    this.client = createTrueForgeClient(cfg);
    this.router = new ResilientModelRouter(cfg);
  }

  async preflight(): Promise<{ ok: boolean; detail: string; notes: string[] }> {
    const health = await checkTrueForge(this.cfg.trueforgeApiUrl);
    if (!health.ok) {
      return { ...health, notes: [] };
    }
    if (!this.provisioned) {
      this.provisionNotes = await provisionHarness(this.client, this.cfg);
      const catalog = await discoverModels(this.cfg);
      const reconciled = reconcileChain(this.cfg.modelFailoverChain, catalog);
      if (reconciled.chain.length > 0) {
        this.router.replaceChain(reconciled.chain);
      }
      if (reconciled.dropped.length) {
        this.provisionNotes.push(`catalog dropped unavailable models: ${reconciled.dropped.join(', ')}`);
      }
      this.provisioned = true;
    }
    return { ok: true, detail: health.detail, notes: this.provisionNotes };
  }

  async triage(failureReport = fixtureFailurePrompt()): Promise<TriageResult> {
    const pre = await this.preflight();
    if (!pre.ok) {
      throw new Error(pre.detail);
    }

    const routed = await this.router.execute(
      'triage',
      async (modelFqn, hop) => {
        this.emit({
          at: new Date().toISOString(),
          kind: 'model',
          modelFqn,
          text: hop > 0 ? `new session after quota failover → ${modelFqn}` : `session model ${modelFqn}`,
        });
        const sessionId = await this.openSession(modelFqn);
        const prompt = hop > 0 ? `${toHandoffPrompt(this.caseFile)}\n\n${failureReport}` : failureReport;
        return this.runUserTurn(sessionId, prompt, modelFqn);
      },
      'standard',
    );

    return {
      ...routed.value,
      modelFqn: routed.modelFqn,
      provisionNotes: this.provisionNotes,
    };
  }

  async approve(sessionId: string, threadId: string, toolCallIds: string[], allow: boolean): Promise<TurnObservation> {
    const stream = await this.client.sessions.createTurnStream(sessionId, {
      input: toolCallIds.map((toolCallId) => ({
        type: 'user.tool_approval' as const,
        threadId,
        toolCallId,
        approval: { status: allow ? 'allow' : 'deny' },
      })),
    });
    return this.consume(stream);
  }

  private async openSession(modelFqn: string): Promise<string> {
    const spec = buildAgentSpec(this.cfg, modelFqn);
    try {
      await this.client.agents.create({ name: AGENT_NAME, manifest: spec });
    } catch {
      // Name already taken — the live spec is still passed inline below.
    }

    const { data: session } = await this.client.sessions.create({
      agent: { spec },
    });
    this.emit({
      at: new Date().toISOString(),
      kind: 'log',
      text: `session ${session.id}`,
    });
    return session.id;
  }

  private async runUserTurn(sessionId: string, failureReport: string, modelFqn: string): Promise<TriageResult> {
    const stream = await this.client.sessions.createTurnStream(sessionId, {
      input: [{ type: 'user.message', content: failureReport }],
    });
    const observation = await this.consume(stream);
    if (observation.sandboxIds[0]) {
      this.caseFile.sandboxId = observation.sandboxIds[0];
    }
    if (observation.outputText) {
      this.caseFile.stackHead = observation.outputText.slice(0, 600);
    }
    this.usageAcc = addUsage(this.usageAcc, readUsage(observation.metrics));
    const budget = evaluateBudget(this.usageAcc, this.cfg);
    this.emit({
      at: new Date().toISOString(),
      kind: 'metrics',
      text: formatTokenomics(observation.metrics, modelFqn),
      modelFqn,
      metrics: observation.metrics,
    });
    if (budget.breached) {
      throw new Error(`budget ${budget.used}/${budget.cap} tokens exceeded`);
    }
    if (observation.status === 'error') {
      const errText = observation.events.find((e) => e.kind === 'error')?.text ?? 'turn error';
      throw new Error(errText);
    }
    return {
      sessionId,
      modelFqn,
      observation,
      tokenomics: formatTokenomics(observation.metrics, modelFqn),
      provisionNotes: this.provisionNotes,
    };
  }

  private async consume(stream: AsyncIterable<unknown>): Promise<TurnObservation> {
    const observer = observeTurn();
    const streamWithMeta = stream as unknown as { withMetadata?: () => AsyncIterable<unknown> };
    const iterable =
      typeof streamWithMeta.withMetadata === 'function' ? streamWithMeta.withMetadata() : stream;

    try {
      for await (const item of iterable) {
        const event = unwrapTurnEvent(item);
        if (!event) {
          continue;
        }
        for (const harnessEvent of observer.feed(event)) {
          this.emit(harnessEvent);
        }
      }
    } catch (error) {
      if (error instanceof TrueForgeError) {
        throw error;
      }
      throw new Error(describeTrueForgeError(error));
    }
    return observer.snapshot();
  }

  private emit(event: HarnessEvent): void {
    this.onEvent(event);
  }
}
