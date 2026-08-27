import type { AppConfig } from './config.js';

export interface CatalogModel {
  fqn: string;
  provider: string;
  id: string;
}

/**
 * Ask the running TrueForge server what models actually exist.
 * Prevents shipping fabricated model ids that 404 on a judge's machine.
 */
export async function discoverModels(cfg: AppConfig): Promise<CatalogModel[]> {
  const url = `${cfg.trueforgeApiUrl.replace(/\/$/, '')}/api/v1/models`;
  try {
    const res = await fetch(url, {
      headers: cfg.trueforgeApiToken ? { authorization: `Bearer ${cfg.trueforgeApiToken}` } : {},
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: string; provider?: string; name?: string }> };
    return (body.data ?? [])
      .map((m) => {
        const id = m.id ?? m.name ?? '';
        const provider = m.provider ?? (id.includes('/') ? id.split('/')[0]! : 'google-gemini');
        const bare = id.includes('/') ? id.split('/').slice(1).join('/') : id;
        return { fqn: id.includes('/') ? id : `${provider}/${bare}`, provider, id: bare };
      })
      .filter((m) => m.id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Intersect the configured chain with reality; keep order, drop ghosts.
 */
export function reconcileChain(
  configured: string[],
  catalog: CatalogModel[]
): { chain: string[]; dropped: string[] } {
  if (catalog.length === 0) return { chain: configured, dropped: [] };
  const live = new Set(catalog.map((m) => m.fqn));
  const chain = configured.filter((m) => live.has(m) || live.has(`google-gemini/${m}`));
  const dropped = configured.filter((m) => !live.has(m) && !live.has(`google-gemini/${m}`));

  if (chain.length === 0) {
    const fallback = catalog.filter((m) => /lite|flash|mini|small|8b/i.test(m.id)).map((m) => m.fqn);
    return {
      chain: (fallback.length ? fallback : catalog.map((m) => m.fqn)).slice(0, 3),
      dropped,
    };
  }
  return { chain, dropped };
}
