import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileChain } from '../src/model-catalog.js';

test('catalog reconciliation preserves an independently configured primary', () => {
  const result = reconcileChain(['custom/primary', 'google-gemini/fallback'], [
    { fqn: 'custom/primary', provider: 'custom', id: 'primary' },
    { fqn: 'google-gemini/fallback', provider: 'google-gemini', id: 'fallback' },
  ]);
  assert.deepEqual(result.chain, ['custom/primary', 'google-gemini/fallback']);
});
