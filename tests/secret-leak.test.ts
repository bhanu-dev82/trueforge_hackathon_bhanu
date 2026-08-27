import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { buildAgentSpec } from '../src/agent-spec.js';

describe('Secret Hygiene & Isolation Test Suite', () => {
  it('never forwards provider keys into the sandbox env or agent manifest', () => {
    const secrets = {
      GEMINI_API_KEY: 'AIza-MOCK-SECRET-KEY-1',
      EXA_API_KEY: 'exa-MOCK-SECRET-KEY-2',
      GITHUB_TOKEN: 'ghp_MOCK-SECRET-TOKEN-3',
      DAYTONA_API_KEY: 'dtn-MOCK-SECRET-KEY-4',
    };

    const cfg = loadConfig({
      ...secrets,
      MODEL_FAILOVER_CHAIN: 'gemini-3.1-flash-lite',
    } as NodeJS.ProcessEnv);

    const serialized = JSON.stringify(buildAgentSpec(cfg, 'gemini-3.1-flash-lite'));

    for (const secretVal of Object.values(secrets)) {
      assert.ok(
        !serialized.includes(secretVal),
        `secret ${secretVal.slice(0, 8)}… leaked into agent manifest`
      );
    }
  });
});
