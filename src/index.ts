import { AgentHarnessRunner } from './agent.js';

async function main() {
  console.log('====================================================');
  console.log('🚀 Launching TrueForge Agent Harness Submission');
  console.log('====================================================');

  const runner = new AgentHarnessRunner();
  try {
    const agent = await runner.setupAgent();
    console.log(`\nAgent is ready! Starting sample task...`);

    const result = await runner.executeTask(
      agent.id,
      'Perform initial system diagnostic, verify MCP connectors, and output system status.'
    );

    console.log('\nResult Summary:', result.response ? 'Success' : 'No response');
  } catch (error) {
    console.error('[Error during agent execution]:', error);
  }
}

main().catch(console.error);
