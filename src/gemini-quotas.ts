/**
 * Free-tier quotas from Google AI Studio → Rate limits
 * Project: "Default Gemini Project" · Free · captured 2026-08-27.
 *
 * Google does not publish a public RPM/RPD table; these numbers are this
 * project's dashboard. Quotas are per project, RPD resets midnight Pacific.
 * Free-tier spend limit is N/A (no 10-minute dollar cap).
 */
export interface ModelQuota {
  dashboardName: string;
  modelId: string;
  rpm: number;
  tpm: number;
  rpd: number;
  role: 'primary' | 'failover' | 'deep' | 'safety-net' | 'unused';
}

export const FREE_TIER_TEXT_MODELS: ModelQuota[] = [
  { dashboardName: 'Gemini 3.1 Flash Lite', modelId: 'gemini-3.1-flash-lite', rpm: 15, tpm: 250_000, rpd: 500, role: 'primary' },
  { dashboardName: 'Gemini 3.5 Flash Lite', modelId: 'gemini-3.5-flash-lite', rpm: 15, tpm: 250_000, rpd: 500, role: 'failover' },
  { dashboardName: 'Gemma 4 26B', modelId: 'gemma-4-26b-a4b-it', rpm: 30, tpm: 16_000, rpd: 14_400, role: 'safety-net' },
  { dashboardName: 'Gemini 3.7 Flash', modelId: 'gemini-3.7-flash', rpm: 5, tpm: 250_000, rpd: 20, role: 'deep' },
  { dashboardName: 'Gemini 3.6 Flash', modelId: 'gemini-3.6-flash', rpm: 5, tpm: 250_000, rpd: 20, role: 'unused' },
  { dashboardName: 'Gemini 3.5 Flash', modelId: 'gemini-3.5-flash', rpm: 5, tpm: 250_000, rpd: 20, role: 'unused' },
  { dashboardName: 'Gemini 2.5 Flash Lite', modelId: 'gemini-2.5-flash-lite', rpm: 10, tpm: 250_000, rpd: 20, role: 'unused' },
  { dashboardName: 'Gemini 2.5 Flash', modelId: 'gemini-2.5-flash', rpm: 5, tpm: 250_000, rpd: 20, role: 'unused' },
];

/** High-RPD flash-lite first. Gemma last: 14.4k RPD but only 16k TPM. */
export const DEFAULT_FAILOVER_IDS = FREE_TIER_TEXT_MODELS.filter((m) =>
  m.role === 'primary' || m.role === 'failover' || m.role === 'safety-net',
).map((m) => `google-gemini/${m.modelId}`);

export const DEEP_MODEL_ID = 'google-gemini/gemini-3.7-flash';

export function quotaForFqn(fqn: string): ModelQuota | undefined {
  const id = fqn.includes('/') ? fqn.slice(fqn.lastIndexOf('/') + 1) : fqn;
  return FREE_TIER_TEXT_MODELS.find((m) => m.modelId === id);
}
