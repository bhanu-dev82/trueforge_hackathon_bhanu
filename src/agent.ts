import { TrueForgeClient } from '@truefoundry/trueforge-sdk';
import { config } from './config.js';

export class AgentHarnessRunner {
  private client: TrueForgeClient;

  constructor() {
    this.client = new TrueForgeClient({
      baseUrl: config.trueforgeApiUrl,
      token: config.trueforgeApiToken,
    });
  }

  /**
   * Registers or updates the main Hackathon Agent in TrueForge.
   */
  async setupAgent() {
    console.log('[TrueForge] Registering Agent Definition...');
    const agent = await this.client.agents.create({
      name: 'production-agent-harness',
      description: 'Production-ready AI agent with MCP tool routing, sub-agents, and safety gates',
      systemPrompt: `You are an autonomous AI Agent built for The Agent Harness Hackathon.
Your guidelines:
1. Reason carefully and verify all inputs before taking destructive actions.
2. Delegate specialized sub-tasks (e.g. log analysis, test generation) to dedicated sub-agents.
3. Leverage connected MCP tools for real-world interactions.
4. Output structured, clear explanations and interactive widgets via Generative UI.`,
      model: {
        provider: config.modelProvider,
        modelId: config.modelId,
        temperature: config.temperature,
      },
      connectors: ['github', 'slack'],
      config: {
        sandbox: { enabled: true },
        generativeUi: { enabled: true },
        clarifyingQuestions: { enabled: true },
        subagents: { enabled: true },
      },
    });

    console.log(`[TrueForge] Agent created successfully: ${agent.id}`);
    return agent;
  }

  /**
   * Runs an interactive turn against the agent session.
   */
  async executeTask(agentId: string, prompt: string) {
    console.log(`[TrueForge] Creating session for agent: ${agentId}`);
    const session = await this.client.sessions.create({ agentId });

    console.log(`[TrueForge] Dispatching turn prompt: "${prompt}"`);
    const stream = await this.client.sessions.turns.createStream(session.id, {
      message: { role: 'user', content: prompt },
    });

    let fullResponse = '';
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        process.stdout.write(event.data.text);
        fullResponse += event.data.text;
      }
    }
    console.log('\n[TrueForge] Turn completed.');
    return { sessionId: session.id, response: fullResponse };
  }
}
