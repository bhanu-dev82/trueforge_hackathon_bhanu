import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TrueForgeError } from '@truefoundry/trueforge-sdk';
import { classifyProviderError } from '../src/gemini-errors.js';

describe('classifyProviderError', () => {
  it('treats quota_exceeded as daily exhaustion: new session, no same-model retry', () => {
    const err = new TrueForgeError({
      statusCode: 429,
      body: { error: { code: 'quota_exceeded', message: 'You have exceeded your daily quota.' } },
    });
    const got = classifyProviderError(err, 1);
    assert.equal(got.quotaClass, 'rpd');
    assert.equal(got.retrySameModel, false);
    assert.equal(got.failoverSession, true);
    assert.equal(got.waitMs, 0);
  });

  it('retries rate_limit_exceeded on the same model first', () => {
    const err = new TrueForgeError({
      statusCode: 429,
      body: { error: { code: 'rate_limit_exceeded', message: 'per minute limit' } },
    });
    const got = classifyProviderError(err, 1);
    assert.equal(got.quotaClass, 'rpm');
    assert.equal(got.retrySameModel, true);
    assert.equal(got.failoverSession, false);
    assert.ok(got.waitMs >= 1000);
  });

  it('failovers RPM after three hits', () => {
    const err = new TrueForgeError({
      statusCode: 429,
      body: { error: { code: 'too_many_requests', message: 'too many requests' } },
    });
    const got = classifyProviderError(err, 3);
    assert.equal(got.failoverSession, true);
    assert.equal(got.retrySameModel, false);
  });

  it('maps RESOURCE_EXHAUSTED gRPC status to a 429 class', () => {
    const err = new TrueForgeError({
      statusCode: 429,
      body: { error: { status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted' } },
    });
    const got = classifyProviderError(err);
    assert.notEqual(got.quotaClass, 'none');
    assert.ok(got.retrySameModel || got.failoverSession);
  });

  it('retries 503 service_unavailable on the same model', () => {
    const err = new TrueForgeError({
      statusCode: 503,
      body: { error: { code: 'service_unavailable', message: 'overloaded' } },
    });
    const got = classifyProviderError(err, 1);
    assert.equal(got.quotaClass, 'transient');
    assert.equal(got.retrySameModel, true);
  });

  it('does not failover a 400', () => {
    const err = new TrueForgeError({
      statusCode: 400,
      body: { error: { code: 'invalid_request', message: 'bad payload' } },
    });
    const got = classifyProviderError(err);
    assert.equal(got.quotaClass, 'none');
    assert.equal(got.failoverSession, false);
  });
});
