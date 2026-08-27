import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CaseStore } from '../src/case-store.js';
import { createInvestigation, sanitizeIntake } from '../src/investigation.js';

test('case store atomically persists a resumable case file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'case-store-'));
  try {
    const store = new CaseStore(root);
    const run = createInvestigation(sanitizeIntake({ title: 'x', failureReport: 'failure', repositoryPath: '.', testCommand: 'npm test' }));
    await store.save(run);
    assert.deepEqual(await store.load(run.id), run);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
