import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TrueForgeError } from '@truefoundry/trueforge-sdk';
import { loadConfig } from '../src/config.js';
import { ResilientModelRouter } from '../src/model-router.js';

function cfg() {
  return loadConfig({
    TRUEFORGE_API_URL: 'http://localhost:8790',
    MODEL_NAME: 'gemini-3.1-flash-lite',
    MODEL_FAILOVER_CHAIN: 'gemini-3.1-flash-lite,gemini-3.5-flash-lite',
  });
}

describe('ResilientModelRouter', () => {
  it('prefixes bare Gemini ids with google-gemini/', () => {
    const router = new ResilientModelRouter(cfg());
    assert.equal(router.resolve('standard'), 'google-gemini/gemini-3.1-flash-lite');
  });

  it('uses the deep model only when asked, not as the default failover', () => {
    const router = new ResilientModelRouter(cfg());
    assert.equal(router.resolve('deep'), 'google-gemini/gemini-3.7-flash');
    assert.equal(router.resolve('standard'), 'google-gemini/gemini-3.1-flash-lite');
  });

  it('opens a new attempt on the next model after daily quota', async () => {
    const router = new ResilientModelRouter(cfg());
    const seen: string[] = [];
    const result = await router.execute('test', async (model) => {
      seen.push(model);
      if (model.endsWith('gemini-3.1-flash-lite')) {
        throw new TrueForgeError({
          statusCode: 429,
          body: { error: { code: 'quota_exceeded', message: 'daily quota' } },
        });
      }
      return `ok:${model}`;
    });
    assert.equal(result.value, 'ok:google-gemini/gemini-3.5-flash-lite');
    assert.deepEqual(seen, [
      'google-gemini/gemini-3.1-flash-lite',
      'google-gemini/gemini-3.5-flash-lite',
    ]);
    assert.equal(result.attempts[0]?.outcome, 'failover');
  });
});
