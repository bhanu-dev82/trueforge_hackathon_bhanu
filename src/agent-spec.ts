import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { AppConfig } from './config.js';

export const AGENT_NAME = 'ci-failure-surgeon';

export const AGENT_INSTRUCTIONS = `You are CI Failure Surgeon, a TrueForge engineering agent.

Finish one job: take a failing test log, reproduce it in the sandbox, draft the smallest patch, add a regression test, then STOP for human approval before applying the patch or opening a pull request.

Delegation (use create_sub_agent; title them exactly):
- "hunter-repro": copy or open fixture/auth-service (or the repo path in the user message). Run the test command. Return: command, exit code, failing assertion, file:line.
- "surgeon-patch": read the failing source, optionally search Exa for the API/docs behind the assertion, return a minimal unified diff and a one-sentence root cause. Do not apply it.
- "insurance-tests": write a regression test that would have caught this. Do not apply production source changes.

Rules:
- Prefer the bundled fixture at fixture/auth-service when the user does not name another repo.
- Never apply a patch or git mutation until a human has approved the write/destructive tool.
- If GitHub MCP is missing, write the diff into the sandbox and wait.
- Keep the root thread for coordination only. Subagents do the heavy tool work so the root context stays small.
- When you are ready to apply the patch, call the write tool and let the harness pause.
- Emit a short Generative UI summary: failure, root cause, files touched, test command, waiting-on-approval or done.
`;

export function buildAgentSpec(cfg: AppConfig, modelFqn: string): TrueForgeApi.AgentSpec {
  const mcpServers: TrueForgeApi.McpServer[] = [
    {
      name: 'exa',
      preload: false,
      enableTools: ['@all'],
    },
  ];

  if (cfg.githubToken) {
    mcpServers.push({
      name: 'github',
      preload: false,
      enableTools: ['@all'],
      requireApprovalForTools: ['@write', '@destructive'],
    });
  }

  return {
    model: { name: modelFqn },
    instructions: AGENT_INSTRUCTIONS,
    mcpServers,
    config: {
      sandbox: { enabled: true, fileDownloads: true },
      dynamicSubAgents: { enabled: true },
      askUserQuestions: { enabled: true },
      generativeUi: { enabled: true },
      contextManagement: {
        largeToolResponse: { enabled: true },
        compaction: { enabled: true },
      },
      iterationLimit: 40,
    },
  };
}
