import assert from 'node:assert/strict';
import test from 'node:test';
import { sign, verify } from '../src/jwt.mjs';

const SECRET = 'fixture-secret';

test('TokenVerifier accepts a valid unexpired JWT', () => {
  const token = sign({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const result = verify(token, SECRET);
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
});

test('TokenVerifier rejects a bad signature', () => {
  const token = sign({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const result = verify(`${token}tampered`, SECRET);
  assert.equal(result.status, 401);
});

test('TokenVerifier rejects an expired JWT', () => {
  const token = sign({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 30 }, SECRET);
  const result = verify(token, SECRET);
  assert.equal(result.status, 401, 'expired tokens must not authenticate');
  assert.equal(result.ok, false);
});
