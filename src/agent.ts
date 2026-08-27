import { TrueForge, TrueForgeError } from '@truefoundry/trueforge-sdk';
import { AGENT_NAME, buildAgentSpec } from './agent-spec.js';
import { config, type AppConfig } from './config.js';
import { formatTokenomics, observeTurn, unwrapTurnEvent, type HarnessEvent, type TurnObservation } from './events.js';
import { checkTrueForge, createTrueForgeClient, describeTrueForgeError } from './harness.js';
import { ResilientModelRouter } from './model-router.js';
import { provisionHarness } from './provision.js';
import { fixtureFailurePrompt } from './fixture-prompt.js';
import { runFixtureTestLocally } from './local-runner.js';
import { toHandoffPrompt, type CaseFile } from './case-file.js';
import { discoverModels, reconcileChain } from './model-catalog.js';
import { redact } from './redaction.js';
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
  private sandboxReady = false;
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
      const provisioned = await provisionHarness(this.client, this.cfg);
      this.provisionNotes = provisioned.notes;
      this.sandboxReady = provisioned.sandbox.configured;
      const catalog = await discoverModels(this.cfg);
      const configured = [this.cfg.modelName, ...this.cfg.modelFailoverChain];
      const reconciled = reconcileChain(configured, catalog);
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

  async triage(
    failureReport = fixtureFailurePrompt(),
    preRepro?: { command: string; exitCode: number; output: string },
  ): Promise<TriageResult> {
    this.usageAcc = {};
    const pre = await this.preflight();
    if (!pre.ok) {
      throw new Error(pre.detail);
    }
    const sandboxNotes = this.provisionNotes.filter((note) => /sandbox|daytona/i.test(note));
    for (const note of sandboxNotes) {
      this.emit({ at: new Date().toISOString(), kind: 'log', text: note });
    }
    try {
      const repro = preRepro ?? await runFixtureTestLocally();
      this.caseFile.stackHead = repro.output.slice(-600);
      this.emit({
        at: new Date().toISOString(),
        kind: 'repro',
        command: repro.command,
        exitCode: repro.exitCode,
        text: repro.output.slice(-800),
        stage: 'hunter',
      });
    } catch (error) {
      this.emit({
        at: new Date().toISOString(),
        kind: 'log',
        text: `pre-repro skipped: ${error instanceof Error ? error.message : String(error)}`,
      });
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
        const isolation = 'Mutation-capable TrueForge sandbox tools are disabled during analysis. Do not claim a sandbox. The test was already reproduced by the controlled runtime; use that evidence, draft only, and pause before any write.';
        const prompt =
          hop > 0
            ? `${toHandoffPrompt(this.caseFile)}\n\n${isolation}\n\n${failureReport}`
            : `${isolation}\n\n${failureReport}`;
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
    const observation = await this.consume(stream);
    this.accountUsage(observation, 'approval continuation');
    return observation;
  }

  private async upsertAgent(spec: ReturnType<typeof buildAgentSpec>): Promise<void> {
    try {
      const listed = await this.client.agents.list();
      const existing = listed.data?.find((agent) => agent.name === AGENT_NAME);
      if (existing?.id) {
        await this.client.agents.update(existing.id, { manifest: spec });
        return;
      }
    } catch {
      // Fall through to create.
    }
    try {
      await this.client.agents.create({ name: AGENT_NAME, manifest: spec });
    } catch {
      // Name taken between list and create — inline spec on the session still wins.
    }
  }

  private async openSession(modelFqn: string): Promise<string> {
    const spec = buildAgentSpec(this.cfg, modelFqn, { sandboxEnabled: this.sandboxReady });
    await this.upsertAgent(spec);

    let session;
    try {
      ({ data: session } = await this.client.sessions.create({
        agent: { spec },
      }));
    } catch (error) {
      if (error instanceof TrueForgeError) throw error;
      throw new Error(this.safeMessage(error));
    }
    if (!session?.id) {
      throw new Error('TrueForge created a session without an id');
    }
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
    this.accountUsage(observation, modelFqn);
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

  private accountUsage(observation: TurnObservation, label: string): void {
    this.usageAcc = addUsage(this.usageAcc, readUsage(observation.metrics));
    const budget = evaluateBudget(this.usageAcc, this.cfg);
    this.emit({
      at: new Date().toISOString(), kind: 'metrics',
      text: `${formatTokenomics(observation.metrics, label)} | run-budget=${budget.used}/${budget.cap}`,
      modelFqn: label, metrics: observation.metrics,
    });
    if (budget.breached) throw new Error(`budget ${budget.used}/${budget.cap} tokens exceeded`);
  }

  private safeMessage(error: unknown): string {
    return redact(describeTrueForgeError(error), [
      this.cfg.trueforgeApiToken, this.cfg.geminiApiKey, this.cfg.exaApiKey,
      this.cfg.githubToken, this.cfg.daytonaApiKey,
    ]);
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
      const message = this.safeMessage(error);
      if (/sandbox is enabled but no sandbox provider/i.test(message)) {
        this.emit({
          at: new Date().toISOString(),
          kind: 'log',
          text: 'Sandbox skipped. Daytona is not configured. The steps above still stand.',
        });
        return observer.snapshot();
      }
      if (error instanceof TrueForgeError) {
        throw error;
      }
      throw new Error(message);
    }
    return observer.snapshot();
  }

  private emit(event: HarnessEvent): void {
    this.onEvent(event);
  }
}
