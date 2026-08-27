import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { fixtureFailurePrompt, fixtureRoot } from '../src/fixture-prompt.js';

describe('auth-service fixture', () => {
  it('currently ignores exp (the bug the agent must fix)', async () => {
    const mod = (await import(pathToFileURL(path.join(fixtureRoot(), 'src/jwt.mjs')).href)) as {
      sign: (payload: object, secret: string) => string;
      verify: (token: string, secret: string) => { status: number; ok: boolean };
    };
    const expired = mod.sign({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 30 }, 'fixture-secret');
    const result = mod.verify(expired, 'fixture-secret');
    assert.equal(result.status, 200);
    assert.equal(result.ok, true);
  });

  it('builds a judge-facing prompt that names the fixture and the assertion', () => {
    const prompt = fixtureFailurePrompt();
    assert.match(prompt, /fixture\/auth-service/);
    assert.match(prompt, /expected status 401, received 200/);
    assert.match(prompt, /payload\.exp/);
  });
});
