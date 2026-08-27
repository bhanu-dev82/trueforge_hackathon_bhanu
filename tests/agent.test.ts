import { describe, it, expect } from '@jest/globals';
import { config } from '../src/config.js';

describe('Hackathon Agent Harness Configuration & Readiness', () => {
  it('should have valid TrueForge API URL configured', () => {
    expect(config.trueforgeApiUrl).toBeDefined();
    expect(config.trueforgeApiUrl).toContain('http');
  });

  it('should have valid default model parameters', () => {
    expect(config.modelProvider).toBeDefined();
    expect(config.modelId).toBeDefined();
    expect(config.temperature).toBeGreaterThanOrEqual(0);
    expect(config.temperature).toBeLessThanOrEqual(2);
  });
});
