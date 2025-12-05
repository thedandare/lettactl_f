import { LettaClientWrapper } from '../lib/letta-client';
import { AgentResolver } from '../lib/agent-resolver';
import { OutputFormatter } from '../lib/output-formatter';
import { validateResourceType } from '../lib/validators';
import { withErrorHandling } from '../lib/error-handler';
import { createSpinner, getSpinnerEnabled } from '../lib/spinner';

async function getCommandImpl(resource: string, name?: string, options?: { output: string }, command?: any) {
  validateResourceType(resource, ['agents']);

  const client = new LettaClientWrapper();
  const resolver = new AgentResolver(client);
  
  if (name) {
    // Get specific agent
    console.log(`Getting agent: ${name}`);
    // TODO: Find agent by name and show details
  } else {
    // List all agents
    const spinnerEnabled = getSpinnerEnabled(command);
    const spinner = createSpinner('Loading agents...', spinnerEnabled).start();
    
    try {
      const agents = await resolver.getAllAgents();
      spinner.stop();
      
      if (OutputFormatter.handleJsonOutput(agents, options?.output)) {
        return;
      }

      if (options?.output === 'yaml') {
        console.log(OutputFormatter.formatOutput(agents, 'yaml'));
        return;
      }

      // Default table output
      console.log(OutputFormatter.createAgentTable(agents));
    } catch (error) {
      spinner.fail('Failed to load agents');
      throw error;
    }
  }
}

export default withErrorHandling('Get command', getCommandImpl);