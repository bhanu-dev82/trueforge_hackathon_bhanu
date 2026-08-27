import { TrueForgeError } from '@truefoundry/trueforge-sdk';

/**
 * Classifier for Gemini / TrueForge provider failures.
 *
 * Error codes come from https://ai.google.dev/gemini-api/docs/api-errors (updated 2026-08-26):
 *   rate_limit_exceeded | quota_exceeded | too_many_requests  → HTTP 429
 *   service_unavailable → HTTP 503
 *   api_error → HTTP 500
 *   deadline_exceeded → HTTP 504
 *
 * gRPC/AI Studio still surfaces `RESOURCE_EXHAUSTED` in `error.status`.
 * Quotas are per Google Cloud *project*, not per API key.
 * RPD resets at midnight Pacific, not UTC (https://ai.google.dev/gemini-api/docs/rate-limits).
 */

export type QuotaClass = 'rpm' | 'rpd' | 'tpm' | 'spend' | 'unknown-429' | 'transient' | 'none';

export interface ClassifiedError {
  quotaClass: QuotaClass;
  retrySameModel: boolean;
  failoverSession: boolean;
  waitMs: number;
  httpStatus?: number;
  providerCode?: string;
  message: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function collectText(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value);
    return;
  }
  const rec = asRecord(value);
  if (!rec) {
    return;
  }
  for (const nested of Object.values(rec)) {
    collectText(nested, into);
  }
}

function parseRetryAfterMs(err: TrueForgeError | undefined, fallbackMs: number): number {
  const header = err?.rawResponse?.headers?.get('retry-after') ?? err?.rawResponse?.headers?.get('Retry-After');
  if (!header) {
    return fallbackMs;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  const when = Date.parse(header);
  if (Number.isFinite(when)) {
    return Math.min(Math.max(when - Date.now(), 0), 60_000);
  }
  return fallbackMs;
}

function jitteredBackoff(attempt: number): number {
  const exp = Math.min(2 ** attempt * 1000, 16_000);
  return exp + Math.floor(Math.random() * 500);
}

export function classifyProviderError(error: unknown, attempt = 1): ClassifiedError {
  const tfError = error instanceof TrueForgeError ? error : undefined;
  const httpStatus = tfError?.statusCode;
  const texts: string[] = [];
  if (error instanceof Error) {
    texts.push(error.message);
  }
  collectText(tfError?.body, texts);
  const blob = texts.join('\n').toLowerCase();

  const body = asRecord(tfError?.body);
  const errorObj = asRecord(body?.error) ?? asRecord(asRecord(body?.body)?.error);
  const providerCode =
    (typeof errorObj?.code === 'string' && errorObj.code) ||
    (typeof errorObj?.status === 'string' && errorObj.status) ||
    undefined;

  const looks429 =
    httpStatus === 429 ||
    providerCode === 'rate_limit_exceeded' ||
    providerCode === 'quota_exceeded' ||
    providerCode === 'too_many_requests' ||
    providerCode === 'RESOURCE_EXHAUSTED' ||
    blob.includes('resource_exhausted') ||
    blob.includes('rate limit') ||
    blob.includes('quota');

  const looksTransient =
    httpStatus === 500 ||
    httpStatus === 503 ||
    httpStatus === 504 ||
    providerCode === 'api_error' ||
    providerCode === 'service_unavailable' ||
    providerCode === 'deadline_exceeded';

  if (!looks429 && !looksTransient) {
    return {
      quotaClass: 'none',
      retrySameModel: false,
      failoverSession: false,
      waitMs: 0,
      httpStatus,
      providerCode,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (looksTransient && !looks429) {
    return {
      quotaClass: 'transient',
      retrySameModel: attempt <= 3,
      failoverSession: attempt > 3,
      waitMs: parseRetryAfterMs(tfError, jitteredBackoff(attempt)),
      httpStatus,
      providerCode,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const isRpd =
    providerCode === 'quota_exceeded' ||
    blob.includes('per day') ||
    blob.includes('requests per day') ||
    blob.includes('rpd') ||
    blob.includes('daily quota');

  const isRpm =
    providerCode === 'rate_limit_exceeded' ||
    providerCode === 'too_many_requests' ||
    blob.includes('per minute') ||
    blob.includes('per second') ||
    blob.includes('rpm');

  const isTpm = blob.includes('tokens per minute') || blob.includes('tpm');
  const isSpend = blob.includes('spend') || blob.includes('billing');

  let quotaClass: QuotaClass = 'unknown-429';
  if (isRpd) quotaClass = 'rpd';
  else if (isSpend) quotaClass = 'spend';
  else if (isTpm) quotaClass = 'tpm';
  else if (isRpm) quotaClass = 'rpm';

  // Daily quota is exhausted until midnight Pacific — do not retry the same model.
  if (quotaClass === 'rpd') {
    return {
      quotaClass,
      retrySameModel: false,
      failoverSession: true,
      waitMs: 0,
      httpStatus,
      providerCode,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // RPM / TPM / spend: Retry-After or exponential backoff on the same model first.
  // After three hits, open a *new* TrueForge session on the next model (never swap mid-session).
  return {
    quotaClass,
    retrySameModel: attempt < 3,
    failoverSession: attempt >= 3,
    waitMs: parseRetryAfterMs(tfError, jitteredBackoff(attempt)),
    httpStatus,
    providerCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function isFailoverWorthy(classified: ClassifiedError): boolean {
  return classified.failoverSession || (classified.retrySameModel === false && classified.quotaClass !== 'none');
}
