import { FleetParser } from '../lib/fleet-parser';
import { LettaClientWrapper } from '../lib/letta-client';
import { BlockManager } from '../lib/block-manager';
import { AgentManager } from '../lib/agent-manager';
import { DiffEngine } from '../lib/diff-engine';
import { FileContentTracker } from '../lib/file-content-tracker';
import { OutputFormatter } from '../lib/output-formatter';
import { createSpinner, getSpinnerEnabled } from '../lib/spinner';
import { SupabaseStorageBackend } from '../lib/storage-backend';
import { minimatch } from 'minimatch';
import * as fs from 'fs';
import * as path from 'path';


export async function applyCommand(options: { file: string; agent?: string; match?: string; dryRun?: boolean; root?: string }, command: any) {
  const verbose = command.parent?.opts().verbose || false;
  try {
    console.log(`Applying configuration from ${options.file}`);
    
    if (options.dryRun) {
      console.log('Dry-run mode enabled');
    }

    if (options.agent) {
      if (verbose) console.log(`Filtering agents by pattern: ${options.agent}`);
    }

    // Initialize Supabase backend if environment variables are available
    let supabaseBackend: SupabaseStorageBackend | undefined;
    
    try {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
        supabaseBackend = new SupabaseStorageBackend();
        console.log('Supabase backend configured for cloud storage access');
      }
    } catch (error: any) {
      console.error(`Supabase configuration error: ${error.message}`);
      process.exit(1);
    }

    const parser = new FleetParser(options.file, { 
      supabaseBackend,
      rootPath: options.root
    });
    const config = await parser.parseFleetConfig(options.file);
    
    if (verbose) console.log(`Found ${config.agents.length} agents in configuration`);

    // Template mode: apply config to existing agents matching pattern
    if (options.match) {
      await applyTemplateMode({ ...options, match: options.match }, config, parser, command);
      return;
    }

    if (options.dryRun) {
      for (const agent of config.agents) {
        console.log(`Would create/update agent: ${agent.name}`);
        if (agent.folders) {
          for (const folder of agent.folders) {
            console.log(`  Would create folder: ${folder.name} with ${folder.files.length} files`);
          }
        }
      }
      return;
    }

    const client = new LettaClientWrapper();
    const blockManager = new BlockManager(client);
    const agentManager = new AgentManager(client);
    const diffEngine = new DiffEngine(client, blockManager, parser.basePath);
    const fileTracker = new FileContentTracker(parser.basePath, parser.storageBackend);
    const createdFolders = new Map<string, string>(); // folder name -> folder id
    
    // Load existing resources for versioning
    if (verbose) console.log('Loading existing blocks...');
    await blockManager.loadExistingBlocks();
    
    if (verbose) console.log('Loading existing agents...');
    await agentManager.loadExistingAgents();
    
    // Process shared blocks first
    const sharedBlockIds = new Map<string, string>();
    if (config.shared_blocks) {
      if (verbose) console.log('Processing shared blocks...');
      for (const sharedBlock of config.shared_blocks) {
        const blockId = await blockManager.getOrCreateSharedBlock(sharedBlock);
        sharedBlockIds.set(sharedBlock.name, blockId);
      }
    }
    
    // Generate tool source hashes for all tools in config
    const allToolNames = new Set<string>();
    for (const agent of config.agents) {
      for (const toolName of agent.tools || []) {
        allToolNames.add(toolName);
      }
    }
    const globalToolSourceHashes = fileTracker.generateToolSourceHashes(Array.from(allToolNames), parser.toolConfigs);
    
    // Register required tools
    if (verbose) console.log('Registering tools...');
    const toolNameToId = await parser.registerRequiredTools(config, client, verbose, globalToolSourceHashes);
    
    // Create/get all folders with duplicate prevention
    if (verbose) console.log('Processing folders...');
    const foldersResponse = await client.listFolders();
    const existingFolders = Array.isArray(foldersResponse) ? foldersResponse : (foldersResponse as any).items || [];
    
    for (const agent of config.agents) {
      if (options.agent && !agent.name.includes(options.agent)) continue;
      
      if (agent.folders) {
        for (const folderConfig of agent.folders) {
          if (createdFolders.has(folderConfig.name)) {
            if (verbose) console.log(`Using existing folder: ${folderConfig.name}`);
            continue;
          }
          
          // Check if folder already exists
          let folder = existingFolders.find((f: any) => f.name === folderConfig.name);
          
          if (!folder) {
            if (verbose) console.log(`Creating folder: ${folderConfig.name}`);
            folder = await client.createFolder({
              name: folderConfig.name,
              embedding: agent.embedding || "letta/letta-free"
            });
            console.log(`Created folder: ${folderConfig.name}`);
            createdFolders.set(folderConfig.name, folder.id);
            
            // Upload files only to newly created folders
            if (verbose) console.log(`Uploading ${folderConfig.files.length} files...`);
            for (const filePath of folderConfig.files) {
              try {
                const resolvedPath = path.resolve(parser.basePath, filePath);
                
                if (!fs.existsSync(resolvedPath)) {
                  console.warn(`File not found, skipping: ${filePath}`);
                  continue;
                }

                if (verbose) console.log(`  Uploading ${filePath}...`);
                const fileStream = fs.createReadStream(resolvedPath);
                
                await client.uploadFileToFolder(
                  fileStream,
                  folder.id,
                  path.basename(filePath)
                );
                
                if (verbose) console.log(`  Uploaded: ${filePath}`);
              } catch (error: any) {
                console.error(`  Failed to upload ${filePath}:`, error.message);
              }
            }
          } else {
            if (verbose) console.log(`Using existing folder: ${folderConfig.name}`);
            if (verbose) console.log('  (Skipping file upload - files already exist)');
            createdFolders.set(folderConfig.name, folder.id);
          }
        }
      }
    }
    
    // Create agents with memory blocks
    if (verbose) console.log('Processing agents...');
    for (const agent of config.agents) {
      if (options.agent && !agent.name.includes(options.agent)) continue;

      console.log(`Processing agent: ${agent.name}`);
      if (verbose) {
        console.log(`  Description: ${agent.description}`);
        console.log(`  Tools: ${agent.tools?.join(', ') || 'none'}`);
        console.log(`  Memory blocks: ${agent.memory_blocks?.length || 0}`);
        console.log(`  Folders: ${agent.folders?.length || 0}`);
      }
      
      try {
        // Generate file content hashes for change detection
        const folderContentHashes = fileTracker.generateFolderFileHashes(agent.folders || []);
        
        // Generate tool source code hashes for change detection  
        const toolSourceHashes = fileTracker.generateToolSourceHashes(agent.tools || [], parser.toolConfigs);
        
        // Generate memory block file content hashes for change detection
        const memoryBlockFileHashes = await fileTracker.generateMemoryBlockFileHashes(agent.memory_blocks || []);
        
        // Check if agent needs to be created based on complete configuration
        const { agentName, shouldCreate, existingAgent } = await agentManager.getOrCreateAgentName(
          agent.name, 
          {
            systemPrompt: agent.system_prompt.value || '',
            tools: agent.tools || [],
            toolSourceHashes,
            model: agent.llm_config?.model,
            embedding: agent.embedding,
            contextWindow: agent.llm_config?.context_window,
            memoryBlocks: (agent.memory_blocks || []).map(block => ({
              name: block.name,
              description: block.description,
              limit: block.limit,
              value: block.value || ''
            })),
            memoryBlockFileHashes,
            folders: (agent.folders || []).map(folder => ({
              name: folder.name,
              files: folder.files,
              fileContentHashes: folderContentHashes.get(folder.name) || {}
            })),
            sharedBlocks: agent.shared_blocks || []
          },
          verbose
        );

        if (!shouldCreate && existingAgent) {
          // Agent exists but may need partial updates  
          const agentConfig = {
            systemPrompt: agent.system_prompt.value || '',
            tools: agent.tools || [],
            toolSourceHashes,
            model: agent.llm_config?.model,
            embedding: agent.embedding,
            contextWindow: agent.llm_config?.context_window,
            memoryBlocks: (agent.memory_blocks || []).map(block => ({
              name: block.name,
              description: block.description,
              limit: block.limit,
              value: block.value || ''
            })),
            memoryBlockFileHashes,
            folders: (agent.folders || []).map(folder => ({
              name: folder.name,
              files: folder.files,
              fileContentHashes: folderContentHashes.get(folder.name) || {}
            })),
            sharedBlocks: agent.shared_blocks || []
          };

          // Check if any granular changes are needed
          const changes = agentManager.getConfigChanges(existingAgent, agentConfig);
          
          if (!changes.hasChanges) {
            console.log(`Agent ${agent.name} already exists and is up to date`);
            continue;
          }

          // Apply partial updates to preserve conversation history
          console.log(`Updating agent ${agent.name}:`);
          
          const spinnerEnabled = getSpinnerEnabled(command);
          const spinner = createSpinner(`Analyzing changes for ${agent.name}...`, spinnerEnabled).start();
          
          try {
            const updateOperations = await diffEngine.generateUpdateOperations(
              existingAgent,
              { ...agentConfig, memoryBlockFileHashes },
              toolNameToId,
              createdFolders,
              verbose,
              sharedBlockIds
            );

            spinner.stop();
            
            // Show granular diff information
            OutputFormatter.showAgentUpdateDiff(updateOperations);

            const updateSpinner = createSpinner(`Applying updates to ${agent.name}...`, spinnerEnabled).start();
            
            await diffEngine.applyUpdateOperations(
              existingAgent.id,
              updateOperations,
              verbose
            );

            // Update registry with new hashes
            agentManager.updateRegistry(existingAgent.name, agentConfig, existingAgent.id);
            
            updateSpinner.succeed(`Agent ${agent.name} updated successfully (conversation history preserved)`);
          } catch (error) {
            spinner.fail(`Failed to update agent ${agent.name}`);
            throw error;
          }
          continue;
        }

        // Collect all block IDs (shared + agent-specific)
        const blockIds: string[] = [];
        
        // Add shared blocks for this agent
        if (agent.shared_blocks) {
          for (const sharedBlockName of agent.shared_blocks) {
            const sharedBlockId = sharedBlockIds.get(sharedBlockName);
            if (sharedBlockId) {
              blockIds.push(sharedBlockId);
              if (verbose) console.log(`  Using shared block: ${sharedBlockName}`);
            } else {
              console.warn(`  Shared block not found: ${sharedBlockName}`);
            }
          }
        }
        
        // Create agent-specific memory blocks
        if (agent.memory_blocks) {
          for (const block of agent.memory_blocks) {
            if (verbose) console.log(`  Processing memory block: ${block.name}`);
            const blockId = await blockManager.getOrCreateAgentBlock(block, agent.name);
            blockIds.push(blockId);
          }
        }

        // Create agent
        const creationSpinner = createSpinner(`Creating agent ${agentName}...`, getSpinnerEnabled(command)).start();

        try {
          // Resolve tool names to IDs
          const toolIds: string[] = [];
          if (agent.tools) {
            for (const toolName of agent.tools) {
              const toolId = toolNameToId.get(toolName);
              if (toolId) {
                toolIds.push(toolId);
              } else {
                console.warn(`  Tool not found: ${toolName}`);
              }
            }
          }

          const createdAgent = await client.createAgent({
            name: agentName,
            model: agent.llm_config?.model || "google_ai/gemini-2.5-pro",
            embedding: agent.embedding || "letta/letta-free",
            system: agent.system_prompt.value || '',
            block_ids: blockIds,
            context_window_limit: agent.llm_config?.context_window || 64000
          });

          // Attach tools after agent creation (same as update path)
          for (const toolId of toolIds) {
            if (verbose) console.log(`  Attaching tool: ${toolId}`);
            await client.attachToolToAgent(createdAgent.id, toolId);
          }

          // Update agent registry with new agent
          agentManager.updateRegistry(agentName, {
            systemPrompt: agent.system_prompt.value || '',
            tools: agent.tools || [],
            model: agent.llm_config?.model,
            embedding: agent.embedding,
            contextWindow: agent.llm_config?.context_window,
            memoryBlocks: (agent.memory_blocks || []).map(block => ({
              name: block.name,
              description: block.description,
              limit: block.limit,
              value: block.value || ''
            })),
            folders: agent.folders || [],
            sharedBlocks: agent.shared_blocks || []
          }, createdAgent.id);
          
          // Attach folders to agent
          if (agent.folders) {
            for (const folderConfig of agent.folders) {
              const folderId = createdFolders.get(folderConfig.name);
              if (folderId) {
                if (verbose) console.log(`  Attaching folder ${folderConfig.name}`);
                await client.attachFolderToAgent(createdAgent.id, folderId);
                if (verbose) console.log(`  Folder attached`);
              }
            }
          }

          creationSpinner.succeed(`Agent ${agentName} created successfully`);
        } catch (error) {
          creationSpinner.fail(`Failed to create agent ${agentName}`);
          throw error;
        }
        
      } catch (error: any) {
        console.error(`Failed to create agent ${agent.name}:`, error.message);
        throw error;
      }
    }

    console.log('Apply completed successfully');

  } catch (error) {
    console.error('Apply failed:', error);
    process.exit(1);
  }
}

/**
 * Template mode: apply a template config to all existing agents matching a glob pattern.
 * Uses MERGE semantics - adds/updates resources but doesn't remove existing ones.
 */
async function applyTemplateMode(
  options: { file: string; match: string; dryRun?: boolean; root?: string },
  config: any,
  parser: FleetParser,
  command: any
): Promise<void> {
  const verbose = command.parent?.opts().verbose || false;
  const spinnerEnabled = getSpinnerEnabled(command);
  const pattern = options.match;

  const findSpinner = createSpinner(`Finding agents matching "${pattern}"...`, spinnerEnabled).start();

  // Get all agents from server
  const client = new LettaClientWrapper();
  const allAgentsResponse = await client.listAgents();
  const allAgents = Array.isArray(allAgentsResponse)
    ? allAgentsResponse
    : (allAgentsResponse as any).items || [];

  // Filter by glob pattern
  const matchingAgents = allAgents.filter((agent: any) =>
    minimatch(agent.name, pattern)
  );

  if (matchingAgents.length === 0) {
    findSpinner.fail(`No agents found matching pattern: ${pattern}`);
    return;
  }

  findSpinner.succeed(`Found ${matchingAgents.length} agents matching "${pattern}"`);
  matchingAgents.forEach((a: any) => console.log(`  - ${a.name}`));

  if (options.dryRun) {
    console.log('\nDry-run mode: no changes will be made');
    return;
  }

  // Initialize managers
  const blockManager = new BlockManager(client);
  const diffEngine = new DiffEngine(client, blockManager, parser.basePath);
  const fileTracker = new FileContentTracker(parser.basePath, parser.storageBackend);
  const createdFolders = new Map<string, string>();

  await blockManager.loadExistingBlocks();

  // Process shared blocks from template
  const sharedBlockIds = new Map<string, string>();
  if (config.shared_blocks?.length) {
    const blockSpinner = createSpinner('Processing shared blocks...', spinnerEnabled).start();
    for (const sharedBlock of config.shared_blocks) {
      const blockId = await blockManager.getOrCreateSharedBlock(sharedBlock);
      sharedBlockIds.set(sharedBlock.name, blockId);
      if (verbose) console.log(`  ${sharedBlock.name} -> ${blockId}`);
    }
    blockSpinner.succeed(`Processed ${config.shared_blocks.length} shared blocks`);
  }

  // Get template agent config (first agent in config, or use top-level values)
  const templateAgent = config.agents?.[0];
  const templateTools = templateAgent?.tools || [];
  const templateSharedBlocks = templateAgent?.shared_blocks || [];

  // Generate tool source hashes and register tools
  const toolSourceHashes = fileTracker.generateToolSourceHashes(templateTools, parser.toolConfigs);
  const toolNameToId = await parser.registerRequiredTools(config, client, verbose, toolSourceHashes);

  // Apply template to each matching agent
  for (const existingAgent of matchingAgents) {
    const agentSpinner = createSpinner(`Analyzing ${existingAgent.name}...`, spinnerEnabled).start();

    try {
      // Build desired config from template (no memoryBlocks - those are instance-specific)
      const desiredConfig = {
        systemPrompt: templateAgent?.system_prompt?.value || '',
        tools: templateTools,
        toolSourceHashes,
        sharedBlocks: templateSharedBlocks,
      };

      // Create minimal AgentVersion for diff engine
      const agentVersion = {
        id: existingAgent.id,
        name: existingAgent.name,
        baseName: existingAgent.name,
        configHashes: { overall: '', systemPrompt: '', tools: '', model: '', memoryBlocks: '', folders: '', sharedBlocks: '' },
        version: 'latest',
        lastUpdated: existingAgent.updated_at || new Date().toISOString()
      };

      // Generate update operations
      const ops = await diffEngine.generateUpdateOperations(
        agentVersion,
        desiredConfig,
        toolNameToId,
        createdFolders,
        verbose,
        sharedBlockIds
      );

      // MERGE semantics: clear toRemove arrays (don't remove existing resources)
      if (ops.tools) ops.tools.toRemove = [];
      if (ops.blocks) ops.blocks.toRemove = [];
      if (ops.folders) ops.folders.toDetach = [];

      // Recalculate operation count after filtering
      ops.operationCount = 0;
      if (ops.updateFields) ops.operationCount += Object.keys(ops.updateFields).length;
      if (ops.tools) ops.operationCount += ops.tools.toAdd.length + ops.tools.toUpdate.length;
      if (ops.blocks) ops.operationCount += ops.blocks.toAdd.length + ops.blocks.toUpdate.length;
      if (ops.folders) ops.operationCount += ops.folders.toAttach.length;

      if (ops.operationCount === 0) {
        agentSpinner.succeed(`${existingAgent.name}: already up to date`);
        continue;
      }

      agentSpinner.stop();
      OutputFormatter.showAgentUpdateDiff(ops);

      const updateSpinner = createSpinner(`Applying updates to ${existingAgent.name}...`, spinnerEnabled).start();
      await diffEngine.applyUpdateOperations(existingAgent.id, ops, verbose);
      updateSpinner.succeed(`${existingAgent.name}: updated successfully`);

    } catch (error: any) {
      agentSpinner.fail(`${existingAgent.name}: ${error.message}`);
    }
  }

  console.log('\nTemplate apply completed');
}