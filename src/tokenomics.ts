import type { AppConfig } from './config.js';

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
}

const ALIASES: Record<keyof Usage, string[]> = {
  input: ['totalInputTokens', 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens'],
  output: ['totalOutputTokens', 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens'],
  cacheRead: [
    'totalCacheReadTokens',
    'cacheReadTokens',
    'cache_read_input_tokens',
    'cachedInputTokens',
    'cached_tokens',
  ],
};

/**
 * Reads whatever metrics the harness actually emitted.
 * Unknown values return undefined, rendered as em dash '—'. Never fabricated 0.
 */
export function readUsage(metrics: unknown): Partial<Usage> {
  const raw = (metrics ?? {}) as Record<string, unknown>;
  const nested = raw.metrics && typeof raw.metrics === 'object' ? (raw.metrics as Record<string, unknown>) : undefined;
  const m = nested ?? raw;
  const out: Partial<Usage> = {};
  for (const key of Object.keys(ALIASES) as (keyof Usage)[]) {
    for (const alias of ALIASES[key]) {
      const v = m[alias];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[key] = v;
        break;
      }
    }
  }
  return out;
}

export interface BudgetState {
  used: number;
  cap: number;
  pct: number;
  breached: boolean;
}

export function evaluateBudget(u: Partial<Usage>, cfg: AppConfig): BudgetState {
  const used = (u.input ?? 0) + (u.output ?? 0);
  const cap = cfg.budgetTokensPerRun;
  return {
    used,
    cap,
    pct: Math.min(100, (used / cap) * 100),
    breached: used > cap,
  };
}

export function calculateCacheHitRate(u: Partial<Usage>): number | undefined {
  if (u.input === undefined || u.cacheRead === undefined || u.input === 0) return undefined;
  return (u.cacheRead / u.input) * 100;
}
