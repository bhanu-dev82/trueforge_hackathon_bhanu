import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TrueForgeError } from '@truefoundry/trueforge-sdk';
import { loadConfig } from '../src/config.js';
import { AllModelsExhaustedError, ResilientModelRouter } from '../src/model-router.js';

describe('Router Exhaustion & Hop Ledger', () => {
  it('throws AllModelsExhaustedError after the chain is spent', async () => {
    const cfg = loadConfig({
      TRUEFORGE_API_URL: 'http://localhost:8790',
      MODEL_NAME: 'google-gemini/model-a',
      MODEL_FAILOVER_CHAIN: 'google-gemini/model-a,google-gemini/model-b',
    });
    const router = new ResilientModelRouter(cfg);

    await assert.rejects(
      () =>
        router.execute('testFailover', async () => {
          throw new TrueForgeError({
            statusCode: 429,
            body: { error: { code: 'quota_exceeded', message: 'daily quota' } },
          });
        }),
      (err: unknown) => err instanceof AllModelsExhaustedError,
    );
  });

  it('passes hop so callers can reseed with a case file on a new session', async () => {
    const cfg = loadConfig({
      TRUEFORGE_API_URL: 'http://localhost:8790',
      MODEL_NAME: 'google-gemini/model-a',
      MODEL_FAILOVER_CHAIN: 'google-gemini/model-a,google-gemini/model-b',
    });
    const router = new ResilientModelRouter(cfg);
    const hops: number[] = [];

    const result = await router.execute('testHop', async (model, hop) => {
      hops.push(hop);
      if (hop === 0) {
        throw new TrueForgeError({
          statusCode: 429,
          body: { error: { code: 'quota_exceeded', message: 'daily quota' } },
        });
      }
      return model;
    });

    assert.deepEqual(hops, [0, 1]);
    assert.equal(result.modelFqn, 'google-gemini/model-b');
  });
});
