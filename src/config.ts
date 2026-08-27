import dotenv from 'dotenv';
import { z } from 'zod';
import { DEFAULT_FAILOVER_IDS, DEEP_MODEL_ID } from './gemini-quotas.js';

dotenv.config();

const GEMINI_PREFIX = 'google-gemini/';

/** TrueForge model FQN is `provider/model`. Bare Gemini ids get the catalog prefix. */
export function toModelFqn(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('model name is empty');
  }
  return trimmed.includes('/') ? trimmed : `${GEMINI_PREFIX}${trimmed}`;
}

const ConfigSchema = z.object({
  trueforgeApiUrl: z.string().url().default('http://localhost:8790'),
  trueforgeApiToken: z.string().optional(),
  geminiApiKey: z.string().optional(),
  exaApiKey: z.string().optional(),
  daytonaApiKey: z.string().optional(),
  gatewayBaseUrl: z.string().url().optional(),
  budgetTokensPerRun: z.number().int().positive().default(120_000),
  modelName: z.string().default('google-gemini/gemini-3.1-flash-lite'),
  modelDeep: z.string().default(DEEP_MODEL_ID),
  modelFailoverChain: z.array(z.string()).min(1),
  githubToken: z.string().optional(),
  teamName: z.string().default('agent-i'),
  demoPort: z.number().int().positive().default(8787),
  autoApprove: z.boolean().default(false),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

function csv(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) {
    return fallback;
  }
  return value
    .split(',')
    .map((part) => toModelFqn(part))
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const fallbackChain = csv(env.MODEL_FAILOVER_CHAIN, DEFAULT_FAILOVER_IDS);

  return ConfigSchema.parse({
    trueforgeApiUrl: env.TRUEFORGE_API_URL || 'http://localhost:8790',
    trueforgeApiToken: env.TRUEFORGE_API_TOKEN || undefined,
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    exaApiKey: env.EXA_API_KEY || undefined,
    daytonaApiKey: env.DAYTONA_API_KEY || undefined,
    gatewayBaseUrl: env.TFY_GATEWAY_BASE_URL || undefined,
    budgetTokensPerRun: env.BUDGET_TOKENS_PER_RUN ? Number(env.BUDGET_TOKENS_PER_RUN) : 120_000,
    modelName: toModelFqn(env.MODEL_NAME || 'gemini-3.1-flash-lite'),
    modelDeep: toModelFqn(env.MODEL_DEEP || env.MODEL_FALLBACK || DEEP_MODEL_ID),
    modelFailoverChain: fallbackChain,
    githubToken: env.GITHUB_TOKEN || undefined,
    teamName: env.TEAM_NAME || 'agent-i',
    demoPort: env.DEMO_PORT ? Number(env.DEMO_PORT) : 8787,
    autoApprove: env.DEMO_AUTO_APPROVE === '1' || env.DEMO_AUTO_APPROVE === 'true',
  });
}

export const config = loadConfig();
