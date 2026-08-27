import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumePending, enqueuePending, peekPending } from '../src/run-queue.js';

test('pending approval is peeked without consumption and removed only after success', () => {
  const live = { threadId: 'live', toolCallIds: ['a'] };
  const run = { pending: [live], observation: { pendingApprovals: [live] } };
  assert.equal(peekPending(run), live);
  assert.equal(peekPending(run), live);
  consumePending(run, live);
  assert.equal(peekPending(run), undefined);
});

test('approval queue deduplicates stream and observation copies', () => {
  const item = { threadId: 'thread', toolCallIds: ['a', 'b'] };
  const queue = [item];
  enqueuePending(queue, { ...item, toolCallIds: [...item.toolCallIds] });
  assert.equal(queue.length, 1);
});
