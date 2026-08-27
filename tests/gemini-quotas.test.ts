import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_FAILOVER_IDS, FREE_TIER_TEXT_MODELS, quotaForFqn } from '../src/gemini-quotas.js';
import { loadConfig } from '../src/config.js';

describe('AI Studio free-tier table', () => {
  it('gives 3.1 and 3.5 flash-lite 500 RPD, and 3.7-flash only 20', () => {
    assert.equal(quotaForFqn('google-gemini/gemini-3.1-flash-lite')?.rpd, 500);
    assert.equal(quotaForFqn('google-gemini/gemini-3.5-flash-lite')?.rpd, 500);
    assert.equal(quotaForFqn('google-gemini/gemini-3.7-flash')?.rpd, 20);
    assert.equal(quotaForFqn('google-gemini/gemini-2.5-flash-lite')?.rpd, 20);
  });

  it('uses Gemma 4 26B as the high-RPD safety net, not as the primary', () => {
    const gemma = quotaForFqn('gemma-4-26b-a4b-it');
    assert.equal(gemma?.rpd, 14_400);
    assert.equal(gemma?.tpm, 16_000);
    assert.equal(gemma?.role, 'safety-net');
    assert.ok(DEFAULT_FAILOVER_IDS[0]?.endsWith('gemini-3.1-flash-lite'));
    assert.ok(DEFAULT_FAILOVER_IDS.at(-1)?.endsWith('gemma-4-26b-a4b-it'));
    assert.ok(!DEFAULT_FAILOVER_IDS.some((id) => id.includes('gemini-3.7-flash')));
  });

  it('loads that chain as the config default', () => {
    const cfg = loadConfig({ TRUEFORGE_API_URL: 'http://localhost:8790' });
    assert.deepEqual(cfg.modelFailoverChain, DEFAULT_FAILOVER_IDS);
  });
});
