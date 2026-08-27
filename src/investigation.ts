import { randomUUID } from 'node:crypto';

export const RUN_STATES = [
  'intake',
  'planning',
  'reproducing',
  'diagnosing',
  'verifying',
  'awaiting_approval',
  'applying',
  'completed',
  'blocked',
  'failed',
] as const;

export type RunStatus = (typeof RUN_STATES)[number];
export type EvidenceKind = 'status' | 'plan' | 'command' | 'finding' | 'verification' | 'approval' | 'runtime' | 'error';

export interface IncidentIntake {
  title: string;
  failureReport: string;
  repositoryPath: string;
  testCommand: string;
  source: 'sample' | 'user';
}

export interface EvidenceEntry {
  id: string;
  at: string;
  actor: 'operator' | 'planner' | 'executor' | 'verifier' | 'harness';
  kind: EvidenceKind;
  summary: string;
  detail?: string;
  command?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  action: string;
  target: string;
  files: string[];
  diff?: string;
  testEvidence: Array<{ command: string; exitCode: number; summary: string }>;
  summary: string;
  reversible: boolean;
  requestedAt: string;
  decidedAt?: string;
  decision?: 'allowed' | 'denied';
  actor?: string;
}

export interface RunEventRecord {
  id: number;
  at: string;
  kind: string;
  [key: string]: unknown;
}

export interface InvestigationCase {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  mode: 'local-only' | 'trueforge-enhanced';
  modeDetail: string;
  intake: IncidentIntake;
  runtime: { mode: 'trueforge' | 'worktree' | 'container' | 'process'; isolated: boolean; detail: string };
  evidence: EvidenceEntry[];
  events: RunEventRecord[];
  approval?: ApprovalRequest;
  proposal?: { summary: string; files: string[]; diff?: string; generatedBy: 'local-rules' | 'trueforge' };
  outcome?: { disposition: 'verified' | 'blocked' | 'failed' | 'awaiting_approval'; summary: string };
}

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  intake: ['planning', 'failed'],
  planning: ['reproducing', 'failed'],
  reproducing: ['diagnosing', 'failed'],
  diagnosing: ['verifying', 'failed'],
  verifying: ['awaiting_approval', 'completed', 'failed'],
  awaiting_approval: ['applying', 'blocked', 'failed'],
  applying: ['completed', 'failed'],
  completed: [],
  blocked: [],
  failed: [],
};

export function sanitizeIntake(value: Partial<IncidentIntake>): IncidentIntake {
  const title = String(value.title ?? '').trim().slice(0, 160);
  const failureReport = String(value.failureReport ?? '').trim().slice(0, 30_000);
  const repositoryPath = String(value.repositoryPath ?? '').trim().slice(0, 500);
  const testCommand = String(value.testCommand ?? '').trim().slice(0, 1_000);
  const source = value.source === 'sample' ? 'sample' : 'user';
  if (!title || !failureReport || !repositoryPath || !testCommand) {
    throw new Error('title, failureReport, repositoryPath, and testCommand are required');
  }
  if (repositoryPath.includes('\0')) throw new Error('repositoryPath contains an invalid character');
  return { title, failureReport, repositoryPath, testCommand, source };
}

export function createInvestigation(intake: IncidentIntake): InvestigationCase {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `run_${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    status: 'intake',
    mode: 'local-only',
    modeDetail: 'Local-only investigation; no model or subagent activity has occurred.',
    intake,
    runtime: { mode: 'process', isolated: false, detail: 'Runtime selection pending' },
    evidence: [],
    events: [],
  };
}

export function transition(run: InvestigationCase, next: RunStatus): void {
  if (!TRANSITIONS[run.status].includes(next)) {
    throw new Error(`invalid run transition: ${run.status} → ${next}`);
  }
  run.status = next;
  run.updatedAt = new Date().toISOString();
}

export function addEvidence(
  run: InvestigationCase,
  entry: Omit<EvidenceEntry, 'id' | 'at'> & Partial<Pick<EvidenceEntry, 'id' | 'at'>>,
): EvidenceEntry {
  const evidence: EvidenceEntry = {
    ...entry,
    id: entry.id ?? `ev_${randomUUID()}`,
    at: entry.at ?? new Date().toISOString(),
  };
  run.evidence.push(evidence);
  run.updatedAt = evidence.at;
  return evidence;
}
