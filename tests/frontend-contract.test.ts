import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

describe('judge console contract', () => {
  it('makes the promise, editable sample, ledger, and informed approval boundary explicit', () => {
    assert.match(html, /From failing CI signal to evidence-backed patch proposal/);
    assert.match(html, /Clearly labeled sample/);
    for (const field of ['title', 'failureReport', 'repositoryPath', 'testCommand']) {
      assert.match(html, new RegExp(`name="${field}"`));
    }
    for (const fact of ['approval-action', 'approval-tool', 'approval-target', 'approval-files', 'approval-diff', 'approval-tests']) {
      assert.match(html, new RegExp(`id="${fact}"`));
    }
  });

  it('restores durable snapshots and reconnects SSE after the last event ID', () => {
    assert.match(script, /localStorage\.getItem\('trueforge:lastRun'\)/);
    assert.match(script, /\?after=\$\{lastEventId\}/);
    assert.match(script, /message\.lastEventId/);
    assert.match(script, /denyButton\.focus\(\)/);
  });
});
