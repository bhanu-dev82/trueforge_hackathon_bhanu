import { classifyProviderError, type ClassifiedError } from './gemini-errors.js';
import { config, toModelFqn, type AppConfig } from './config.js';

export type TaskComplexity = 'standard' | 'deep';

export interface RouteAttempt {
  modelFqn: string;
  attempt: number;
  outcome: 'ok' | 'retry-same' | 'failover' | 'failed';
  quotaClass?: ClassifiedError['quotaClass'];
  waitMs?: number;
}

export interface RoutedResult<T> {
  value: T;
  modelFqn: string;
  attempts: RouteAttempt[];
}

export class AllModelsExhaustedError extends Error {
  constructor(
    message: string,
    public readonly attempts: RouteAttempt[],
  ) {
    super(message);
    this.name = 'AllModelsExhaustedError';
  }
}

/**
 * Session-level model router.
 *
 * TrueForge binds a model at session creation. Swapping models mid-session
 * invalidates the KV cache (kickoff stream + TrueForge docs). On quota failure
 * we therefore open a *new* session with the next model in the chain.
 *
 * `gemini-3.7-flash` is deep-only (20 RPD on this project's free-tier dashboard).
 * Failover: 3.1 flash-lite (500 RPD) → 3.5 flash-lite (500) → Gemma 4 26B (14.4k RPD, 16k TPM).
 */
export class ResilientModelRouter {
  private readonly chain: string[];
  private readonly deepModel: string;
  private readonly exhausted = new Set<string>();
  private cursor = 0;

  constructor(private readonly cfg: AppConfig = config) {
    const primary = toModelFqn(cfg.modelName);
    const rest = cfg.modelFailoverChain.map(toModelFqn).filter((id) => id !== primary);
    this.chain = [primary, ...rest];
    this.deepModel = toModelFqn(cfg.modelDeep);
  }

  resolve(complexity: TaskComplexity = 'standard'): string {
    if (complexity === 'deep' && !this.exhausted.has(this.deepModel)) {
      return this.deepModel;
    }
    for (let i = 0; i < this.chain.length; i += 1) {
      const candidate = this.chain[(this.cursor + i) % this.chain.length];
      if (!this.exhausted.has(candidate)) {
        return candidate;
      }
    }
    return this.chain[this.cursor] ?? this.chain[0];
  }

  markExhausted(modelFqn: string): void {
    this.exhausted.add(toModelFqn(modelFqn));
  }

  replaceChain(chain: string[]): void {
    const next = chain.map(toModelFqn).filter(Boolean);
    if (next.length === 0) {
      return;
    }
    this.chain.splice(0, this.chain.length, ...next);
    this.cursor = 0;
  }

  async execute<T>(
    operationName: string,
    run: (modelFqn: string, hop: number) => Promise<T>,
    complexity: TaskComplexity = 'standard',
  ): Promise<RoutedResult<T>> {
    const attempts: RouteAttempt[] = [];
    let model = this.resolve(complexity);
    const maxFailovers = Math.max(this.chain.length, 1);

    for (let hop = 0; hop < maxFailovers; hop += 1) {
      for (let sameModelAttempt = 1; sameModelAttempt <= 3; sameModelAttempt += 1) {
        try {
          const value = await run(model, hop);
          attempts.push({ modelFqn: model, attempt: sameModelAttempt, outcome: 'ok' });
          return { value, modelFqn: model, attempts };
        } catch (error) {
          const classified = classifyProviderError(error, sameModelAttempt);
          if (classified.quotaClass === 'none') {
            attempts.push({
              modelFqn: model,
              attempt: sameModelAttempt,
              outcome: 'failed',
              quotaClass: classified.quotaClass,
            });
            throw error;
          }

          if (classified.retrySameModel && sameModelAttempt < 3) {
            attempts.push({
              modelFqn: model,
              attempt: sameModelAttempt,
              outcome: 'retry-same',
              quotaClass: classified.quotaClass,
              waitMs: classified.waitMs,
            });
            console.warn(
              `[router] ${operationName}: ${classified.quotaClass} on ${model}; retrying same model in ${classified.waitMs}ms`,
            );
            await sleep(classified.waitMs);
            continue;
          }

          this.markExhausted(model);
          attempts.push({
            modelFqn: model,
            attempt: sameModelAttempt,
            outcome: 'failover',
            quotaClass: classified.quotaClass,
            waitMs: classified.waitMs,
          });
          const next = this.nextModel(model);
          console.warn(
            `[router] ${operationName}: ${classified.quotaClass} exhausted ${model}; new TrueForge session on ${next}`,
          );
          if (classified.waitMs > 0) {
            await sleep(classified.waitMs);
          }
          model = next;
          this.cursor = Math.max(
            0,
            this.chain.findIndex((id) => id === next),
          );
          break;
        }
      }
    }

    throw new AllModelsExhaustedError(
      `[router] ${operationName} failed after ${attempts.length} attempts`,
      attempts,
    );
  }

  private nextModel(current: string): string {
    const idx = this.chain.findIndex((id) => id === current);
    for (let i = 1; i <= this.chain.length; i += 1) {
      const candidate = this.chain[(Math.max(idx, 0) + i) % this.chain.length];
      if (!this.exhausted.has(candidate)) {
        return candidate;
      }
    }
    return this.chain[(Math.max(idx, 0) + 1) % this.chain.length];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
