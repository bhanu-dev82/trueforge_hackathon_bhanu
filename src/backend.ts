import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CIFailureSurgeon } from './agent.js';
import { config, type AppConfig } from './config.js';
import { CaseStore } from './case-store.js';
import { runControlled, within } from './controlled-runtime.js';
import { addEvidence, createInvestigation, sanitizeIntake, transition, type InvestigationCase, type RunEventRecord } from './investigation.js';
import { checkTrueForge, describeTrueForgeError } from './harness.js';
import { FREE_TIER_TEXT_MODELS } from './gemini-quotas.js';
import { fixtureFailurePrompt } from './fixture-prompt.js';
import { consumePending, enqueuePending, peekPending, type PendingApproval } from './run-queue.js';
import { redact } from './redaction.js';
import type { HarnessEvent, TurnObservation } from './events.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(projectRoot, 'public');
const TERMINAL = new Set(['completed', 'blocked', 'failed']);

interface RunState {
  caseFile: InvestigationCase;
  sessionId?: string;
  observation?: TurnObservation;
  pending: PendingApproval[];
  approvalInFlight: boolean;
  surgeon?: CIFailureSurgeon;
  clients: Set<ServerResponse>;
  persistChain: Promise<void>;
}

export interface BackendOptions {
  projectRoot?: string;
  publicDir?: string;
  store?: CaseStore;
  config?: AppConfig;
  trueForgeAvailable?: () => Promise<boolean>;
  runControlled?: typeof runControlled;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage, limit = 64_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('invalid JSON body'), { statusCode: 400 }); }
}

function mime(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

export function createBackend(options: BackendOptions = {}): Server {
  const root = path.resolve(options.projectRoot ?? projectRoot);
  const assets = path.resolve(options.publicDir ?? publicDir);
  const appConfig = options.config ?? config;
  const store = options.store ?? new CaseStore(path.join(root, '.ci-surgeon/runs'));
  const reproduce = options.runControlled ?? runControlled;
  const runs = new Map<string, RunState>();
  const secrets = [appConfig.trueforgeApiToken, appConfig.geminiApiKey, appConfig.exaApiKey, appConfig.githubToken, appConfig.daytonaApiKey];
  const safe = (value: string) => redact(value, secrets);

  const persist = async (run: RunState) => {
    run.persistChain = run.persistChain.catch(() => undefined).then(() => store.save(run.caseFile));
    return run.persistChain;
  };
  const emit = (run: RunState, event: Omit<RunEventRecord, 'id'>): RunEventRecord => {
    const record = { ...event, id: (run.caseFile.events.at(-1)?.id ?? 0) + 1 } as RunEventRecord;
    run.caseFile.events.push(record);
    run.caseFile.updatedAt = record.at;
    for (const client of run.clients) client.write(`id: ${record.id}\ndata: ${JSON.stringify(record)}\n\n`);
    void persist(run);
    return record;
  };

  const execute = async (run: RunState): Promise<void> => {
    const caseFile = run.caseFile;
    try {
      transition(caseFile, 'reproducing');
      emit(run, { at: new Date().toISOString(), kind: 'status', text: 'Bounded reproduction started.' });
      const result = await reproduce(root, caseFile.intake.repositoryPath, caseFile.intake.testCommand);
      caseFile.runtime = result.runtime;
      addEvidence(caseFile, { actor: 'executor', kind: 'command', summary: `Reproduction exited ${result.exitCode}${result.timedOut ? ' after timeout' : ''}`, detail: result.output.slice(-4000), command: result.command, exitCode: result.exitCode, durationMs: result.durationMs });
      emit(run, { at: new Date().toISOString(), kind: 'repro', command: result.command, exitCode: result.exitCode, runtime: result.runtime });
      transition(caseFile, 'diagnosing');
      await persist(run);

      const available = options.trueForgeAvailable ? await options.trueForgeAvailable() : (await checkTrueForge(appConfig.trueforgeApiUrl)).ok;
      if (!available) {
        caseFile.mode = 'local-only';
        caseFile.modeDetail = 'LOCAL-ONLY: TrueForge unavailable. Evidence and proposal review are deterministic; no model or subagent activity occurred.';
        addEvidence(caseFile, { actor: 'harness', kind: 'finding', summary: 'Local-only diagnosis recorded from supplied failure report and bounded reproduction.', detail: `${caseFile.intake.failureReport}\n\n${result.output.slice(-4000)}` });
        transition(caseFile, 'verifying');
        addEvidence(caseFile, { actor: 'verifier', kind: 'verification', summary: `Local verification: command exited ${result.exitCode}; no patch was generated or applied.` });
        caseFile.proposal = { summary: 'No automatic write proposal in local-only mode. Review the preserved evidence before authoring a change.', files: [], generatedBy: 'local-rules' };
        caseFile.outcome = { disposition: 'verified', summary: 'Local-only investigation completed with evidence preserved; no model, subagent, or write activity.' };
        transition(caseFile, 'completed');
        if (TERMINAL.has(caseFile.status)) emit(run, { at: new Date().toISOString(), kind: 'run.complete', mode: caseFile.mode, status: caseFile.status });
        await persist(run);
        return;
      }

      caseFile.mode = 'trueforge-enhanced';
      caseFile.modeDetail = 'TrueForge enhanced investigation; Daytona isolation is used when configured and accepted.';
      const surgeon = new CIFailureSurgeon(appConfig, (raw: HarnessEvent) => {
        const event = raw as HarnessEvent & { tool?: string; action?: string; target?: string; files?: string[]; diff?: string };
        if (event.kind === 'approval' && event.threadId && event.toolCallIds?.length) {
          enqueuePending(run.pending, { threadId: event.threadId, toolCallIds: event.toolCallIds });
          caseFile.approval = {
            id: event.toolCallIds[0] ?? 'unknown-tool-call', tool: event.tool ?? 'unknown', action: event.action ?? 'write',
            target: event.target ?? caseFile.intake.repositoryPath, files: event.files ?? [], diff: event.diff,
            testEvidence: caseFile.evidence.filter((item) => item.kind === 'command' && item.command && item.exitCode != null).map((item) => ({ command: item.command!, exitCode: item.exitCode!, summary: item.summary })),
            summary: event.text ?? 'Proposed write requires operator review.', reversible: true, requestedAt: event.at,
          };
          if (caseFile.status === 'verifying') transition(caseFile, 'awaiting_approval');
        }
        if (event.kind === 'log' && event.text?.startsWith('session ')) run.sessionId ??= event.text.slice(8).trim();
        emit(run, { ...event, at: event.at });
      });
      run.surgeon = surgeon;
      const report = `${caseFile.intake.failureReport}\n\nControlled reproduction: ${result.command}; exit ${result.exitCode}.\n${result.output.slice(-4000)}`;
      const triage = await surgeon.triage(report, result);
      run.sessionId = triage.sessionId;
      run.observation = triage.observation;
      for (const pending of triage.observation.pendingApprovals) enqueuePending(run.pending, pending);
      if (caseFile.status === 'diagnosing') transition(caseFile, 'verifying');
      addEvidence(caseFile, { actor: 'verifier', kind: 'verification', summary: 'TrueForge verifier turn completed.', detail: triage.observation.outputText.slice(0, 4000) });
      if (peekPending(run)) {
        if (caseFile.status === 'verifying') transition(caseFile, 'awaiting_approval');
        caseFile.outcome = { disposition: 'awaiting_approval', summary: 'An enriched write record is waiting for operator approval.' };
      } else {
        if (caseFile.status === 'verifying') transition(caseFile, 'completed');
        caseFile.outcome = { disposition: 'verified', summary: 'Enhanced investigation completed without a pending write.' };
      }
      if (TERMINAL.has(caseFile.status)) emit(run, { at: new Date().toISOString(), kind: 'run.complete', mode: caseFile.mode, status: caseFile.status });
      await persist(run);
    } catch (error) {
      const message = safe(describeTrueForgeError(error));
      if (!TERMINAL.has(caseFile.status)) transition(caseFile, 'failed');
      caseFile.outcome = { disposition: 'failed', summary: message };
      addEvidence(caseFile, { actor: 'harness', kind: 'error', summary: message });
      emit(run, { at: new Date().toISOString(), kind: 'error', text: message, status: 'failed' });
      await persist(run);
    }
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = await readFile(path.join(assets, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/static/')) {
        let relative: string;
        try { relative = decodeURIComponent(url.pathname.slice('/static/'.length)); } catch { json(res, 400, { error: 'invalid path' }); return; }
        const candidate = path.resolve(assets, relative);
        if (!relative || !within(assets, candidate)) { json(res, 403, { error: 'forbidden' }); return; }
        const canonical = await realpath(candidate);
        if (!within(await realpath(assets), canonical)) { json(res, 403, { error: 'forbidden' }); return; }
        const data = await readFile(canonical); res.writeHead(200, { 'Content-Type': mime(canonical), 'X-Content-Type-Options': 'nosniff' }); res.end(data); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        const enhanced = options.trueForgeAvailable ? await options.trueForgeAvailable() : (await checkTrueForge(appConfig.trueforgeApiUrl)).ok;
        json(res, 200, {
          ok: true,
          mode: enhanced ? 'trueforge-enhanced' : 'local-only',
          trueforge: enhanced,
          model: enhanced ? appConfig.modelName : undefined,
          team: appConfig.teamName,
          capabilities: {
            localRuntime: true,
            sandbox: false,
            github: enhanced && Boolean(appConfig.githubToken),
            research: enhanced && Boolean(appConfig.exaApiKey),
          },
          note: enhanced ? 'TrueForge enhanced analysis is available; mutation-capable sandbox tools stay disabled until a server-enforced second phase exists.' : 'LOCAL-ONLY is available; no model or subagent activity will be claimed.',
        }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/quotas') {
        json(res, 200, { models: FREE_TIER_TEXT_MODELS }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/isolation') {
        json(res, 200, { mode: 'runtime-selection', provider: '', note: 'Local runtime prefers configured rootless Podman, then rootless Docker, then an ephemeral worktree, then a bounded no-shell process.' }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/fixture') {
        json(res, 200, { prompt: fixtureFailurePrompt() }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/audit') {
        try {
          const ledger = await readFile(path.join(root, 'audit/decisions.jsonl'), 'utf8');
          json(res, 200, JSON.parse(safe(JSON.stringify({ decisions: ledger.split('\n').filter(Boolean).map((line) => JSON.parse(line)) }))));
        } catch { json(res, 200, { decisions: [] }); }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/runs') {
        const value = await body(req) as Record<string, unknown>;
        const sample = Object.keys(value).length === 0;
        const intake = sanitizeIntake(sample ? {
          title: 'Expired tokens still return 200',
          failureReport: fixtureFailurePrompt(),
          repositoryPath: 'fixture/auth-service',
          testCommand: 'node --test tests/token_verifier.test.mjs',
          source: 'sample',
        } : { ...value, source: 'user' });
        const caseFile = createInvestigation(intake);
        const run: RunState = { caseFile, pending: [], approvalInFlight: false, clients: new Set(), persistChain: Promise.resolve() };
        runs.set(caseFile.id, run);
        transition(caseFile, 'planning');
        addEvidence(caseFile, { actor: 'planner', kind: 'plan', summary: 'Bound scope, reproduce without a shell, preserve evidence, then select local-only or TrueForge enhanced diagnosis.' });
        emit(run, { at: new Date().toISOString(), kind: 'mode', text: 'Runtime mode selection pending.' });
        await persist(run);
        void execute(run);
        json(res, 202, { id: caseFile.id, snapshot: caseFile }); return;
      }
      const snapshot = url.pathname.match(/^\/api\/runs\/(run_[0-9a-f-]+)$/i);
      if (req.method === 'GET' && snapshot) {
        const live = runs.get(snapshot[1]); const saved = live?.caseFile ?? await store.load(snapshot[1]);
        json(res, saved ? 200 : 404, saved ?? { error: 'unknown run' }); return;
      }
      const events = url.pathname.match(/^\/api\/runs\/(run_[0-9a-f-]+)\/events$/i);
      if (req.method === 'GET' && events) {
        const live = runs.get(events[1]); const saved = live?.caseFile ?? await store.load(events[1]);
        if (!saved) { json(res, 404, { error: 'unknown run' }); return; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const last = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
        for (const event of saved.events.filter((item) => item.id > (Number.isFinite(last) ? last : 0))) res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
        if (live && !TERMINAL.has(saved.status)) { live.clients.add(res); req.once('close', () => live.clients.delete(res)); }
        else res.end();
        return;
      }
      const approve = url.pathname.match(/^\/api\/runs\/(run_[0-9a-f-]+)\/approve$/i);
      if (req.method === 'POST' && approve) {
        const run = runs.get(approve[1]); const decision = await body(req) as { allow?: unknown };
        if (typeof decision.allow !== 'boolean') { json(res, 400, { error: 'allow must be boolean' }); return; }
        const pending = run ? peekPending(run) : undefined;
        if (!run?.sessionId || !run.surgeon || !pending || run.approvalInFlight || run.caseFile.status !== 'awaiting_approval' || !run.caseFile.approval) { json(res, 409, { error: 'nothing waiting for approval' }); return; }
        const decidedApproval = run.caseFile.approval;
        run.approvalInFlight = true;
        let continuation: TurnObservation;
        try {
          continuation = await run.surgeon.approve(run.sessionId, pending.threadId, pending.toolCallIds, decision.allow);
        } catch (error) {
          run.approvalInFlight = false;
          throw error;
        }
        consumePending(run, pending);
        for (const next of continuation.pendingApprovals) enqueuePending(run.pending, next);
        run.observation = continuation;
        run.approvalInFlight = false;
        const hasMore = Boolean(peekPending(run));
        if (!decision.allow) transition(run.caseFile, 'blocked');
        else if (!hasMore) { transition(run.caseFile, 'applying'); transition(run.caseFile, 'completed'); }
        Object.assign(decidedApproval, { decision: decision.allow ? 'allowed' : 'denied', decidedAt: new Date().toISOString(), actor: 'human:judge-console' });
        run.caseFile.outcome = { disposition: !decision.allow ? 'blocked' : hasMore ? 'awaiting_approval' : 'verified', summary: !decision.allow ? 'Operator denied the recorded action.' : hasMore ? 'Another gated action is waiting for review.' : 'Operator allowed the recorded action and the continuation completed.' };
        addEvidence(run.caseFile, { actor: 'operator', kind: 'approval', summary: decision.allow ? 'Recorded action allowed' : 'Recorded action denied' });
        await persist(run);
        await mkdir(path.join(root, 'audit'), { recursive: true });
        const audit = { runId: run.caseFile.id, approvalId: decidedApproval.id, action: decidedApproval.action, decision: decidedApproval.decision, decidedAt: decidedApproval.decidedAt, actor: decidedApproval.actor };
        await appendFile(path.join(root, 'audit/decisions.jsonl'), `${safe(JSON.stringify(audit))}\n`, { mode: 0o600 });
        if (TERMINAL.has(run.caseFile.status)) emit(run, { at: new Date().toISOString(), kind: 'run.complete', mode: run.caseFile.mode, status: run.caseFile.status });
        json(res, 200, { allow: decision.allow, snapshot: run.caseFile }); return;
      }
      json(res, 404, { error: 'not found' });
    } catch (error) {
      const status = Number((error as { statusCode?: number }).statusCode) || (/required|allowlisted|repositoryPath|shell operators/.test(String(error)) ? 400 : 500);
      json(res, status, { error: error instanceof Error ? safe(error.message) : 'internal error' });
    }
  });
  server.requestTimeout = 65_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createBackend();
  server.listen(config.demoPort, '127.0.0.1', () => console.log(`Harness console → http://127.0.0.1:${config.demoPort}`));
}
