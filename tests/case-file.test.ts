import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toHandoffPrompt } from '../src/case-file.js';

describe('case-file handoff', () => {
  it('is a short resume brief, not a full prompt replay', () => {
    const prompt = toHandoffPrompt({
      repoUrl: 'fixture/auth-service',
      testCommand: 'node --test tests/token_verifier.test.mjs',
      sandboxId: 'sbx_1',
      failingTest: 'TokenVerifier rejects an expired JWT',
      stackHead: 'AssertionError: expected status 401, received 200',
      stage: 'operate',
    });
    assert.match(prompt, /RESUMING/);
    assert.match(prompt, /sbx_1/);
    assert.ok(prompt.length < 2000);
  });
});
