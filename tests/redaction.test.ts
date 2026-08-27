import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact } from '../src/redaction.js';

test('redacts configured values, bearer credentials, and secret assignments', () => {
  const value = redact('Bearer abc.def token=xyz API_KEY: known-value', ['known-value']);
  assert.equal(value.includes('abc.def'), false);
  assert.equal(value.includes('xyz'), false);
  assert.equal(value.includes('known-value'), false);
});
