import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runFixtureTestLocally } from '../src/local-runner.js';
import { daytonaManifest } from '../src/provision.js';
import { buildAgentSpec } from '../src/agent-spec.js';
import { loadConfig } from '../src/config.js';

test('runFixtureTestLocally fails on the expired JWT (exit !== 0)', async () => {
  const result = await runFixtureTestLocally();
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /expired/i);
  assert.match(result.command, /token_verifier/);
});

test('daytonaManifest is a settings payload, not an agent-spec field', () => {
  const manifest = daytonaManifest('dtn-not-a-real-key');
  assert.equal(manifest.type, 'daytona');
  assert.equal(manifest.auth.apiKey, 'dtn-not-a-real-key');
  const spec = JSON.stringify(
    buildAgentSpec(loadConfig({ TRUEFORGE_API_URL: 'http://localhost:8790' }), 'google-gemini/gemini-3.1-flash-lite'),
  );
  assert.equal(spec.includes('dtn-not-a-real-key'), false);
});

test('sandbox can be switched off when no provider is configured', () => {
  const spec = buildAgentSpec(
    loadConfig({ TRUEFORGE_API_URL: 'http://localhost:8790' }),
    'google-gemini/gemini-3.1-flash-lite',
    { sandboxEnabled: false },
  );
  assert.equal(spec.config?.sandbox?.enabled, false);
});
