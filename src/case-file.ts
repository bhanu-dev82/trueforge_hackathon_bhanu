export interface CaseFile {
  repoUrl: string;
  testCommand: string;
  sandboxId?: string;
  failingTest?: string;
  stackHead?: string;
  candidateDiff?: string;
  stage: 'hunt' | 'operate' | 'insure' | 'gate' | 'done';
}

/**
 * ~250-token handoff brief used to reseed a session after a provider quota failover.
 * Preserves context and reattaches the existing Daytona sandbox rather than restarting from zero.
 */
export function toHandoffPrompt(cf: CaseFile): string {
  return [
    'RESUMING a triage after a provider quota failover. Do not restart from zero.',
    `repo: ${cf.repoUrl}`,
    `test: ${cf.testCommand}`,
    cf.sandboxId ? `sandbox: ${cf.sandboxId} (ALREADY PROVISIONED — reattach, do not create a new one)` : '',
    cf.failingTest ? `failing test: ${cf.failingTest}` : '',
    cf.stackHead ? `stack head:\n${cf.stackHead.slice(0, 600)}` : '',
    cf.candidateDiff ? `candidate diff so far:\n${cf.candidateDiff.slice(0, 1200)}` : '',
    `resume at stage: ${cf.stage}`,
  ]
    .filter(Boolean)
    .join('\n');
}
