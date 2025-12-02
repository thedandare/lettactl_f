import { LettaClientWrapper } from '../lib/letta-client';
import { AgentResolver } from '../lib/agent-resolver';

export default async function updateCommand(
  resource: string, 
  name: string, 
  options: { 
    name?: string;
    description?: string;
    model?: string;
    system?: string;
    contextWindow?: number;
    embedding?: string;
    timezone?: string;
    tags?: string;
  }, 
  command: any
) {
  const verbose = command.parent?.opts().verbose || false;
  
  try {
    if (resource !== 'agent') {
      throw new Error('Only "agent" resource is currently supported for updates');
    }

    const client = new LettaClientWrapper();
    const resolver = new AgentResolver(client);

    // Find the agent
    const { agent } = await resolver.findAgentByName(name);
    
    if (verbose) {
      console.log(`Updating agent: ${agent.name} (${agent.id})`);
    }

    // Build update payload
    const updatePayload: any = {};

    if (options.name) updatePayload.name = options.name;
    if (options.description) updatePayload.description = options.description;
    if (options.model) updatePayload.model = options.model;
    if (options.system) updatePayload.system = options.system;
    if (options.contextWindow) updatePayload.context_window_limit = options.contextWindow;
    if (options.embedding) updatePayload.embedding = options.embedding;
    if (options.timezone) updatePayload.timezone = options.timezone;
    if (options.tags) {
      updatePayload.tags = options.tags.split(',').map(tag => tag.trim());
    }

    if (Object.keys(updatePayload).length === 0) {
      console.log('No updates specified. Use --help to see available options.');
      return;
    }

    if (verbose) {
      console.log('Update payload:', JSON.stringify(updatePayload, null, 2));
    }

    // Update the agent
    const updatedAgent = await client.updateAgent(agent.id, updatePayload);
    
    console.log(`Agent ${agent.name} updated successfully`);
    
    if (verbose) {
      console.log(`Updated agent ID: ${updatedAgent.id}`);
      if (updatePayload.name) console.log(`Name changed to: ${updatePayload.name}`);
      if (updatePayload.model) console.log(`Model changed to: ${updatePayload.model}`);
      if (updatePayload.embedding) console.log(`Embedding changed to: ${updatePayload.embedding}`);
    }

  } catch (error: any) {
    console.error(`Failed to update agent ${name}:`, error.message);
    throw error;
  }
}