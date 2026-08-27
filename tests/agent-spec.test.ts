import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AGENT_NAME, buildAgentSpec } from '../src/agent-spec.js';
import { loadConfig } from '../src/config.js';
import { observeTurn, stageFromThreadTitle, unwrapTurnEvent } from '../src/events.js';

describe('agent spec', () => {
  it('keeps mutation-capable sandbox off while enabling subagents, genui, and deferred exa tools', () => {
    const spec = buildAgentSpec(
      loadConfig({ TRUEFORGE_API_URL: 'http://localhost:8790' }),
      'google-gemini/gemini-3.1-flash-lite',
    );
    assert.equal(AGENT_NAME, 'ci-failure-surgeon');
    assert.equal(spec.model.name, 'google-gemini/gemini-3.1-flash-lite');
    assert.equal(spec.config?.sandbox?.enabled, false);
    assert.equal(spec.config?.sandbox?.fileDownloads, false);
    assert.equal(spec.config?.dynamicSubAgents?.enabled, true);
    assert.equal(spec.config?.askUserQuestions?.enabled, false);
    assert.equal(spec.config?.generativeUi?.enabled, true);
    assert.equal(spec.mcpServers?.[0]?.name, 'exa');
    assert.equal(spec.mcpServers?.[0]?.preload, false);
    assert.deepEqual(spec.mcpServers?.[0]?.requireApprovalForTools, ['@write', '@destructive']);
    assert.equal(
      spec.mcpServers?.some((s) => s.name === 'github'),
      false,
    );
  });

  it('gates GitHub writes when a token is present', () => {
    const spec = buildAgentSpec(
      loadConfig({ TRUEFORGE_API_URL: 'http://localhost:8790', GITHUB_TOKEN: 'ghs_test' }),
      'google-gemini/gemini-3.1-flash-lite',
    );
    const github = spec.mcpServers?.find((s) => s.name === 'github');
    assert.ok(github);
    assert.deepEqual(github.requireApprovalForTools, ['@write', '@destructive']);
  });
});

describe('turn events', () => {
  it('unwraps both raw events and withMetadata envelopes', () => {
    const raw = unwrapTurnEvent({ type: 'sandbox.created', sandboxId: 'sbx', createdAt: 't', id: '1', threadId: null });
    const wrapped = unwrapTurnEvent({
      data: { type: 'tool.approval_required', toolCalls: [{ id: 'c1', sourceEventId: 'e' }], threadId: 'main', createdAt: 't', id: '2' },
    });
    assert.equal(raw?.type, 'sandbox.created');
    assert.equal(wrapped?.type, 'tool.approval_required');
  });

  it('maps subagent titles onto pipeline stages', () => {
    assert.equal(stageFromThreadTitle('planner'), 'hunter');
    assert.equal(stageFromThreadTitle('executor'), 'surgeon');
    assert.equal(stageFromThreadTitle('independent-verifier'), 'insurance');
  });

  it('does not treat waiting_for_input as a human pause unless a write is gated', () => {
    const observer = observeTurn();
    const emitted = observer.feed({
      type: 'turn.done',
      createdAt: 't',
      id: '1',
      threadId: 'main',
      state: { status: 'waiting_for_input' },
    } as never);
    assert.equal(emitted.length, 0);
  });
});
