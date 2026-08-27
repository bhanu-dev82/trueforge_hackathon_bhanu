import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInvestigation, sanitizeIntake, transition, addEvidence } from '../src/investigation.js';
import { parseCommand } from '../src/controlled-runtime.js';

describe('controlled investigation contract', () => {
  it('enforces monotonic run transitions and append-only evidence', () => {
    const run = createInvestigation(sanitizeIntake({
      title: 'CI failure', failureReport: 'expected 1 received 2', repositoryPath: '.', testCommand: 'npm test', source: 'user',
    }));
    transition(run, 'planning');
    addEvidence(run, { actor: 'planner', kind: 'plan', summary: 'Reproduce before proposing changes' });
    assert.equal(run.status, 'planning');
    assert.equal(run.evidence.length, 1);
    assert.throws(() => transition(run, 'completed'), /invalid run transition/);
  });

  it('rejects shell operators while preserving argv quoting', () => {
    assert.deepEqual(parseCommand('node --test "tests/a test.mjs"'), ['node', '--test', 'tests/a test.mjs']);
    assert.throws(() => parseCommand('npm test && rm -rf .'), /shell operators/);
  });
});
