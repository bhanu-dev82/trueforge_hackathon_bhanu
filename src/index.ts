import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { CIFailureSurgeon } from './agent.js';
import { config } from './config.js';
import { formatTokenomics } from './events.js';
import { fixtureFailurePrompt } from './fixture-prompt.js';

async function main(): Promise<void> {
  console.log(`CI Failure Surgeon  ·  team ${config.teamName}`);
  console.log(`TrueForge ${config.trueforgeApiUrl}  ·  model ${config.modelName}`);
  console.log('');

  const surgeon = new CIFailureSurgeon(config, (event) => {
    if (event.kind === 'delta') {
      process.stdout.write(event.text ?? '');
      return;
    }
    if (event.kind === 'sandbox') {
      console.log(`\n[sandbox] ${event.sandboxId}`);
    } else if (event.kind === 'thread') {
      console.log(`\n[subagent] ${event.title}`);
    } else if (event.kind === 'approval') {
      console.log(`\n[approval] ${event.text}`);
    } else if (event.kind === 'error') {
      console.error(`\n[error] ${event.text}`);
    }
  });

  const result = await surgeon.triage(fixtureFailurePrompt());
  console.log('\n');
  console.log('session', result.sessionId);
  console.log(formatTokenomics(result.observation.metrics, result.modelFqn));
  for (const note of result.provisionNotes) {
    console.log('provision:', note);
  }

  const pending = result.observation.pendingApprovals[0];
  if (!pending) {
    return;
  }

  if (config.autoApprove) {
    console.log('DEMO_AUTO_APPROVE set — allowing gated tools (not the judge path).');
    await surgeon.approve(result.sessionId, pending.threadId, pending.toolCallIds, true);
    return;
  }

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question('Allow gated tool calls? [y/N] ');
  rl.close();
  const allow = answer.trim().toLowerCase() === 'y';
  await surgeon.approve(result.sessionId, pending.threadId, pending.toolCallIds, allow);
  console.log(allow ? 'approved' : 'denied');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
