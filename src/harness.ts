import { TrueForge, TrueForgeError } from '@truefoundry/trueforge-sdk';
import { config, type AppConfig } from './config.js';

export function createTrueForgeClient(cfg: AppConfig = config): TrueForge {
  return new TrueForge({
    baseUrl: cfg.trueforgeApiUrl,
    token: cfg.trueforgeApiToken,
    timeoutInSeconds: 600,
  });
}

export async function checkTrueForge(baseUrl = config.trueforgeApiUrl): Promise<{ ok: boolean; detail: string }> {
  const root = baseUrl.replace(/\/$/, '');
  const urls = [`${root}/healthz`, `${root}/api/v1/health`, root];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        return { ok: true, detail: `${url} → ${res.status}` };
      }
    } catch {
      // try next probe
    }
  }
  return {
    ok: false,
    detail: `TrueForge is not reachable at ${root}. Start it with: npx @truefoundry/trueforge@latest`,
  };
}

export function describeTrueForgeError(error: unknown): string {
  if (error instanceof TrueForgeError) {
    return [error.message, error.statusCode ? `HTTP ${error.statusCode}` : undefined].filter(Boolean).join(' — ');
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
