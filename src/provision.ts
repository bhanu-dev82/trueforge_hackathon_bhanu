import type { TrueForge } from '@truefoundry/trueforge-sdk';
import type { AppConfig } from './config.js';
import { toModelFqn } from './config.js';
import { describeTrueForgeError } from './harness.js';

function modelIdFromFqn(fqn: string): string {
  const slash = fqn.lastIndexOf('/');
  return slash === -1 ? fqn : fqn.slice(slash + 1);
}

function resourceName(modelId: string): string {
  return modelId.replace(/[._]/g, '-');
}

export interface SandboxStatus {
  configured: boolean;
  type?: string;
  status?: string;
  reason?: string;
}

let lastDaytonaNote: string | undefined;

export function lastSandboxNote(): string | undefined {
  return lastDaytonaNote;
}

export function daytonaManifest(apiKey: string) {
  return {
    type: 'daytona' as const,
    auth: { apiKey },
    autoStopIntervalInMinutes: 15,
    autoArchiveIntervalInMinutes: 60,
    autoDeleteIntervalInMinutes: 180,
    execTimeoutMs: 120_000,
  };
}

export async function readSandboxStatus(client: TrueForge): Promise<SandboxStatus> {
  try {
    const { data } = await client.settings.sandboxProviders.get();
    const type = data?.manifest?.type ?? undefined;
    return {
      configured: Boolean(type),
      type,
      status: data?.status ?? undefined,
      reason: data?.statusReason ?? undefined,
    };
  } catch {
    return { configured: false };
  }
}

/**
 * Push Gemini, Exa, optional GitHub, and Daytona into the running TrueForge
 * instance so judges are not blocked on a Settings click-path.
 *
 * Failures are logged and ignored: the operator can still configure the UI.
 */
export async function provisionHarness(
  client: TrueForge,
  cfg: AppConfig,
): Promise<{ notes: string[]; sandbox: SandboxStatus }> {
  const notes: string[] = [];

  if (cfg.geminiApiKey) {
    const unique = new Set(
      [cfg.modelName, cfg.modelDeep, ...cfg.modelFailoverChain].map((id) => toModelFqn(id)),
    );
    try {
      await client.settings.modelProviders.createOrUpdate({
        manifest: {
          type: 'google-gemini',
          auth: { apiKey: cfg.geminiApiKey },
          models: [...unique].map((fqn) => {
            const modelId = modelIdFromFqn(fqn);
            return {
              modelId,
              name: resourceName(modelId),
              properties: { contextLength: 1_048_576, maxOutputTokens: 65_536 },
            };
          }),
        },
      });
      notes.push(`google-gemini provider upserted (${unique.size} models)`);
    } catch (error) {
      notes.push(`google-gemini provider skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    notes.push('GEMINI_API_KEY missing — configure Settings → Models in TrueForge');
  }

  try {
    await client.settings.mcpServers.createOrUpdate({
      manifest: {
        type: 'remote',
        name: 'exa',
        description: 'Web search and page fetch for error docs and known issues',
        url: 'https://mcp.exa.ai/mcp',
        ...(cfg.exaApiKey
          ? { auth: { type: 'header' as const, headers: { 'x-api-key': cfg.exaApiKey } } }
          : {}),
      },
    });
    notes.push('exa MCP connector upserted');
  } catch (error) {
    notes.push(`exa MCP skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (cfg.githubToken) {
    try {
      await client.settings.mcpServers.createOrUpdate({
        manifest: {
          type: 'remote',
          name: 'github',
          description: 'Optional PR creation after human approval',
          url: 'https://api.githubcopilot.com/mcp/',
          auth: {
            type: 'header',
            headers: { Authorization: `Bearer ${cfg.githubToken}` },
          },
        },
      });
      notes.push('github MCP connector upserted');
    } catch (error) {
      notes.push(`github MCP skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (cfg.daytonaApiKey) {
    try {
      await client.settings.sandboxProviders.createOrUpdate({
        manifest: daytonaManifest(cfg.daytonaApiKey),
      });
      lastDaytonaNote = undefined;
      notes.push('daytona sandbox provider upserted into TrueForge Settings');
    } catch (error) {
      lastDaytonaNote = describeTrueForgeError(error);
      notes.push(`daytona sandbox skipped: ${lastDaytonaNote}`);
    }
  } else {
    lastDaytonaNote = 'DAYTONA_API_KEY is not set';
    notes.push('DAYTONA_API_KEY missing — sandbox stays off so the run does not 422');
  }

  const sandbox = await readSandboxStatus(client);
  if (sandbox.configured) {
    notes.push(`sandbox provider live: ${sandbox.type ?? 'unknown'} (${sandbox.status ?? 'ready'})`);
  } else {
    notes.push('sandbox provider not configured in TrueForge — sessions will run without isolation');
  }

  return { notes, sandbox };
}
