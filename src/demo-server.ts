import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CIFailureSurgeon } from './agent.js';
import { config } from './config.js';
import type { HarnessEvent, TurnObservation } from './events.js';
import { fixtureFailurePrompt } from './fixture-prompt.js';
import { FREE_TIER_TEXT_MODELS } from './gemini-quotas.js';
import { checkTrueForge } from './harness.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

interface RunState {
  id: string;
  sessionId?: string;
  modelFqn?: string;
  events: HarnessEvent[];
  observation?: TurnObservation;
  tokenomics?: string;
  error?: string;
  clients: Set<ServerResponse>;
}

const runs = new Map<string, RunState>();

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sseWrite(res: ServerResponse, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function mime(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.demoPort}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
      send(res, 200, html, 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/static/')) {
      const file = path.join(publicDir, url.pathname.replace('/static/', ''));
      if (!file.startsWith(publicDir)) {
        send(res, 403, { error: 'forbidden' });
        return;
      }
      const buf = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime(file) });
      res.end(buf);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const health = await checkTrueForge(config.trueforgeApiUrl);
      send(res, 200, { ...health, model: config.modelName, team: config.teamName });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/quotas') {
      send(res, 200, {
        source: 'Google AI Studio free tier, Default Gemini Project, 2026-08-27',
        rpdResets: 'midnight Pacific',
        models: FREE_TIER_TEXT_MODELS,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fixture') {
      send(res, 200, { prompt: fixtureFailurePrompt() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/runs') {
      const runId = `run_${Date.now().toString(36)}`;
      const run: RunState = { id: runId, events: [], clients: new Set() };
      runs.set(runId, run);

      const surgeon = new CIFailureSurgeon(config, (event) => {
        run.events.push(event);
        for (const client of run.clients) {
          sseWrite(client, event);
        }
      });

      void surgeon
        .triage()
        .then((result) => {
          run.sessionId = result.sessionId;
          run.modelFqn = result.modelFqn;
          run.observation = result.observation;
          run.tokenomics = result.tokenomics;
          const done = {
            at: new Date().toISOString(),
            kind: 'metrics' as const,
            text: result.tokenomics,
            modelFqn: result.modelFqn,
            metrics: result.observation.metrics,
          };
          run.events.push(done);
          for (const client of run.clients) {
            sseWrite(client, done);
            sseWrite(client, { kind: 'run.complete', sessionId: result.sessionId });
          }
        })
        .catch((error) => {
          run.error = error instanceof Error ? error.message : String(error);
          const failed = { at: new Date().toISOString(), kind: 'error' as const, text: run.error, stage: 'error' as const };
          run.events.push(failed);
          for (const client of run.clients) {
            sseWrite(client, failed);
          }
        });

      send(res, 202, { id: runId });
      return;
    }

    const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (req.method === 'GET' && eventsMatch) {
      const run = runs.get(eventsMatch[1]);
      if (!run) {
        send(res, 404, { error: 'unknown run' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      for (const event of run.events) {
        sseWrite(res, event);
      }
      run.clients.add(res);
      req.on('close', () => run.clients.delete(res));
      return;
    }

    const approveMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/approve$/);
    if (req.method === 'POST' && approveMatch) {
      const run = runs.get(approveMatch[1]);
      if (!run?.sessionId || !run.observation?.pendingApprovals[0]) {
        send(res, 409, { error: 'nothing waiting for approval' });
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}') as { allow?: boolean };
      const pending = run.observation.pendingApprovals[0];
      const surgeon = new CIFailureSurgeon(config, (event) => {
        run.events.push(event);
        for (const client of run.clients) {
          sseWrite(client, event);
        }
      });
      const allow = body.allow !== false;
      const observation = await surgeon.approve(run.sessionId, pending.threadId, pending.toolCallIds, allow);
      run.observation = observation;
      await mkdir('audit', { recursive: true });
      await appendFile(
        'audit/decisions.jsonl',
        `${JSON.stringify({
          ts: new Date().toISOString(),
          actor: 'human:judge-console',
          verdict: allow ? 'ALLOW' : 'DENY',
          sessionId: run.sessionId,
        })}\n`,
      );
      send(res, 200, { status: observation.status, allow });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/audit') {
      try {
        const jsonl = await readFile('audit/decisions.jsonl', 'utf8');
        const decisions = jsonl.split('\n').filter(Boolean).map((line) => JSON.parse(line));
        send(res, 200, { decisions });
      } catch {
        send(res, 200, { decisions: [] });
      }
      return;
    }

    send(res, 404, { error: 'not found' });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(config.demoPort, '127.0.0.1', () => {
  console.log(`Harness console → http://127.0.0.1:${config.demoPort}`);
  console.log(`TrueForge       → ${config.trueforgeApiUrl}`);
  console.log('No login. Open the console, press Reproduce fixture.');
});
