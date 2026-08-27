import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addUsage, readUsage, evaluateBudget, calculateCacheHitRate } from '../src/tokenomics.js';
import { loadConfig } from '../src/config.js';

describe('Tokenomics & Budget Accounting Test Suite', () => {
  it('correctly extracts aliases from metrics payload', () => {
    const metrics = {
      input_tokens: 1200,
      output_tokens: 450,
      cache_read_input_tokens: 800,
    };
    const usage = readUsage(metrics);
    assert.equal(usage.input, 1200);
    assert.equal(usage.output, 450);
    assert.equal(usage.cacheRead, 800);
  });

  it('reads TrueForge TurnMetrics field names', () => {
    const usage = readUsage({
      totalInputTokens: 900,
      totalOutputTokens: 110,
      totalCacheReadTokens: 400,
    });
    assert.equal(usage.input, 900);
    assert.equal(usage.output, 110);
    assert.equal(usage.cacheRead, 400);
  });

  it('calculates cache hit percentage correctly', () => {
    const usage = { input: 1000, output: 200, cacheRead: 650 };
    const hitRate = calculateCacheHitRate(usage);
    assert.equal(hitRate, 65);
  });

  it('evaluates budget consumption and breach status', () => {
    const cfg = loadConfig({ BUDGET_TOKENS_PER_RUN: '1000' } as NodeJS.ProcessEnv);
    const usageNormal = { input: 500, output: 200 };
    const budgetNormal = evaluateBudget(usageNormal, cfg);
    assert.equal(budgetNormal.used, 700);
    assert.equal(budgetNormal.breached, false);

    const usageBreach = { input: 800, output: 400 };
    const budgetBreach = evaluateBudget(usageBreach, cfg);
    assert.equal(budgetBreach.used, 1200);
    assert.equal(budgetBreach.breached, true);

    const summed = addUsage({ input: 400, output: 50 }, { input: 400, output: 50 });
    assert.equal(evaluateBudget(summed, cfg).used, 900);
  });
});
