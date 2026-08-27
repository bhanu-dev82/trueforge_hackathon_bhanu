import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { CaseStore } from '../src/case-store.js';
import { createBackend } from '../src/backend.js';
import type { RuntimeResult } from '../src/controlled-runtime.js';

let base = '';
let temporary = '';
let server: ReturnType<typeof createBackend>;

const fakeRepro = async (_root: string, repositoryPath: string, command: string): Promise<RuntimeResult> => ({
  command,
  cwd: repositoryPath,
  exitCode: 1,
  output: 'AssertionError: expected status 401, received 200',
  durationMs: 5,
  timedOut: false,
  truncated: false,
  runtime: { mode: 'process', isolated: false, detail: 'test bounded process' },
});

before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'backend-http-'));
  server = createBackend({
    projectRoot: path.resolve('.'),
    store: new CaseStore(temporary),
    trueForgeAvailable: async () => false,
    runControlled: fakeRepro,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(temporary, { recursive: true, force: true });
});

async function createRun() {
  const response = await fetch(`${base}/api/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'expired token', failureReport: 'expected 401 got 200', repositoryPath: 'fixture/auth-service', testCommand: 'node --test tests/token_verifier.test.mjs' }),
  });
  assert.equal(response.status, 202);
  return response.json() as Promise<{ id: string }>;
}

async function waitForSnapshot(id: string) {
  for (let index = 0; index < 50; index += 1) {
    const snapshot = await (await fetch(`${base}/api/runs/${id}`)).json();
    if (['completed', 'failed', 'blocked'].includes(snapshot.status)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('run did not finish');
}

describe('HTTP backend reliability', () => {
  it('validates JSON and required intake fields', async () => {
    const invalidJson = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(invalidJson.status, 400);
    const missing = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'only title' }) });
    assert.equal(missing.status, 400);
  });

  it('creates a truthful local-only run and returns a durable snapshot', async () => {
    const { id } = await createRun();
    const snapshot = await waitForSnapshot(id);
    assert.equal(snapshot.mode, 'local-only');
    assert.equal(snapshot.status, 'completed');
    assert.match(snapshot.modeDetail, /no model or subagent activity occurred/i);
    assert.equal(snapshot.proposal.generatedBy, 'local-rules');
    assert.equal(snapshot.proposal.files.length, 0);
    assert.ok(snapshot.events.length >= 3);
  });

  it('replays SSE records after Last-Event-ID and terminates for completed runs', async () => {
    const { id } = await createRun();
    const snapshot = await waitForSnapshot(id);
    const firstId = snapshot.events[0].id;
    const response = await fetch(`${base}/api/runs/${id}/events`, { headers: { 'Last-Event-ID': String(firstId) } });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.doesNotMatch(text, new RegExp(`id: ${firstId}\\n`));
    assert.match(text, /event|data:/);
  });

  it('rejects approval transitions without an actual pending enhanced write', async () => {
    const { id } = await createRun();
    await waitForSnapshot(id);
    const malformed = await fetch(`${base}/api/runs/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(malformed.status, 400);
    const noGate = await fetch(`${base}/api/runs/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allow: true }) });
    assert.equal(noGate.status, 409);
  });

  it('creates collision-resistant isolated IDs under concurrent intake', async () => {
    const created = await Promise.all(Array.from({ length: 20 }, () => createRun()));
    assert.equal(new Set(created.map((item) => item.id)).size, created.length);
    const snapshots = await Promise.all(created.map((item) => waitForSnapshot(item.id)));
    assert.ok(snapshots.every((item, index) => item.id === created[index]?.id));
  });

  it('contains static paths, including encoded traversal', async () => {
    const attempts = ['/static/../package.json', '/static/%2e%2e%2fpackage.json', '/static/%2e%2e/package.json'];
    for (const route of attempts) {
      const response = await fetch(`${base}${route}`);
      assert.notEqual(response.status, 200, route);
    }
    assert.equal((await fetch(`${base}/static/app.js`)).status, 200);
  });
});
