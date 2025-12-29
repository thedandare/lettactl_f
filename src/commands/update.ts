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
    addTool?: string;
    removeTool?: string;
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

    // Handle tool additions/removals
    let toolChanges = false;
    
    if (options.addTool) {
      const toolsToAdd = options.addTool.split(',').map(t => t.trim());
      for (const toolName of toolsToAdd) {
        try {
          // Try to find tool by name (handles core tools)
          let tool = await client.getToolByName(toolName);
          
          if (!tool) {
            // Try finding by ID if it looks like one
            const allTools = await client.listTools();
            const toolList = Array.isArray(allTools) ? allTools : (allTools as any).items || [];
            tool = toolList.find((t: any) => t.id === toolName || t.name === toolName);
          }
          
          if (tool) {
            if (verbose) console.log(`Attaching tool ${tool.name} (${tool.id})...`);
            await client.attachToolToAgent(String(agent.id), String(tool.id));
            console.log(`Tool attached: ${tool.name}`);
            toolChanges = true;
          } else {
            console.warn(`Warning: Tool '${toolName}' not found.`);
          }
        } catch (error: any) {
          console.error(`Failed to attach tool ${toolName}:`, error.message);
        }
      }
    }
    
    if (options.removeTool) {
      const toolsToRemove = options.removeTool.split(',').map(t => t.trim());
      for (const toolName of toolsToRemove) {
        try {
          // Need to find the tool first to get ID
          let toolId = toolName;
          let toolNameDisplay = toolName;
          
          // If it doesn't look like an ID, resolve it
          if (!toolName.startsWith('tool-')) {
             let tool = await client.getToolByName(toolName);
             
             if (!tool) {
                // Fallback search
                const allTools = await client.listTools();
                const toolList = Array.isArray(allTools) ? allTools : (allTools as any).items || [];
                tool = toolList.find((t: any) => t.name === toolName);
             }
             
             if (tool) {
               toolId = String(tool.id);
               toolNameDisplay = String(tool.name);
             }
          }
          
          if (verbose) console.log(`Detaching tool ${toolNameDisplay} (${toolId})...`);
          await client.detachToolFromAgent(String(agent.id), String(toolId));
          console.log(`Tool detached: ${toolNameDisplay}`);
          toolChanges = true;
        } catch (error: any) {
          console.warn(`Failed to detach tool ${toolName}:`, error.message);
        }
      }
    }

    if (Object.keys(updatePayload).length === 0 && !toolChanges) {
      console.log('No updates specified. Use --help to see available options.');
      return;
    }

    if (verbose) {
      console.log('Update payload:', JSON.stringify(updatePayload, null, 2));
    }

    // Update the agent
    if (Object.keys(updatePayload).length > 0) {
      const updatedAgent = await client.updateAgent(agent.id, updatePayload);
      
      console.log(`Agent ${agent.name} updated successfully`);
      
      if (verbose) {
        console.log(`Updated agent ID: ${updatedAgent.id}`);
        if (updatePayload.name) console.log(`Name changed to: ${updatePayload.name}`);
        if (updatePayload.model) console.log(`Model changed to: ${updatePayload.model}`);
        if (updatePayload.embedding) console.log(`Embedding changed to: ${updatePayload.embedding}`);
      }
    } else if (toolChanges) {
      console.log(`Agent ${agent.name} updated successfully`);
    }

  } catch (error: any) {
    console.error(`Failed to update agent ${name}:`, error.message);
    throw error;
  }
}