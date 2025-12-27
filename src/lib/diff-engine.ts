import { LettaClientWrapper } from './letta-client';
import { AgentVersion } from './agent-manager';
import { BlockManager } from './block-manager';
import { normalizeResponse } from './response-normalizer';
import { DiffApplier } from './diff-applier';

export interface ToolDiff {
  toAdd: Array<{ name: string; id: string }>;
  toRemove: Array<{ name: string; id: string }>;
  toUpdate: Array<{ name: string; currentId: string; newId: string; reason: string }>;
  unchanged: Array<{ name: string; id: string }>;
}

export interface BlockDiff {
  toAdd: Array<{ name: string; id: string }>;
  toRemove: Array<{ name: string; id: string }>;
  toUpdate: Array<{ name: string; currentId: string; newId: string }>;
  unchanged: Array<{ name: string; id: string }>;
}

export interface FolderDiff {
  toAttach: Array<{ name: string; id: string }>;
  toDetach: Array<{ name: string; id: string }>;
  toUpdate: Array<{ 
    name: string; 
    id: string; 
    filesToAdd: string[]; 
    filesToRemove: string[]; 
    filesToUpdate: string[];
  }>;
  unchanged: Array<{ name: string; id: string }>;
}

export interface AgentUpdateOperations {
  // Basic agent field updates (preserve conversation)
  updateFields?: {
    system?: string;
    model?: string;
    embedding?: string;
    contextWindow?: number;
  };
  
  // Resource management operations
  tools?: ToolDiff;
  blocks?: BlockDiff;
  folders?: FolderDiff;
  
  // Metadata
  preservesConversation: boolean;
  operationCount: number;
}

/**
 * DiffEngine determines what specific operations are needed to update an agent
 * while preserving conversation history whenever possible
 */
export class DiffEngine {
  private client: LettaClientWrapper;
  private blockManager: BlockManager;
  private basePath: string;

  constructor(client: LettaClientWrapper, blockManager: BlockManager, basePath: string = '') {
    this.client = client;
    this.blockManager = blockManager;
    this.basePath = basePath;
  }

  /**
   * Helper method to check if an item has file-based content that might have changed
   */
  private hasFileBasedContent(itemName: string, fileHashes: Record<string, string>): boolean {
    return !!fileHashes[itemName];
  }

  /**
   * Analyzes differences between existing and desired agent configuration
   * and generates specific update operations that preserve conversation history
   */
  async generateUpdateOperations(
    existingAgent: AgentVersion,
    desiredConfig: {
      systemPrompt: string;
      tools: string[];
      toolSourceHashes?: Record<string, string>;
      model?: string;
      embedding?: string;
      contextWindow?: number;
      memoryBlocks?: Array<{name: string; description: string; limit: number; value: string}>;
      memoryBlockFileHashes?: Record<string, string>;
      folders?: Array<{name: string; files: string[]}>;
      sharedBlocks?: string[];
    },
    toolRegistry: Map<string, string>,
    folderRegistry: Map<string, string>,
    verbose: boolean = false,
    sharedBlockIds?: Map<string, string>
  ): Promise<AgentUpdateOperations> {
    
    const operations: AgentUpdateOperations = {
      preservesConversation: true,
      operationCount: 0
    };

    if (verbose) console.log(`  Analyzing configuration changes for agent: ${existingAgent.name}`);

    // Get current agent state from server
    const currentAgent = await this.client.getAgent(existingAgent.id);
    const currentToolsResponse = await this.client.listAgentTools(existingAgent.id);
    const currentBlocksResponse = await this.client.listAgentBlocks(existingAgent.id);
    const currentFoldersResponse = await this.client.listAgentFolders(existingAgent.id);
    
    // Normalize responses to arrays
    const currentTools = normalizeResponse(currentToolsResponse);
    const currentBlocks = normalizeResponse(currentBlocksResponse);
    const currentFolders = normalizeResponse(currentFoldersResponse);

    // Analyze basic field changes
    const fieldUpdates: any = {};
    
    // For system prompt comparison, check if they're actually different
    // Note: desiredConfig.systemPrompt includes base instructions + user prompt
    // currentAgent.system is the full composed prompt from the server
    const normalizedCurrent = (currentAgent.system || '').trim();
    const normalizedDesired = (desiredConfig.systemPrompt || '').trim();
    
    if (normalizedCurrent !== normalizedDesired) {
      if (verbose) console.log(`    System prompt differs - current length: ${normalizedCurrent.length}, desired length: ${normalizedDesired.length}`);
      fieldUpdates.system = desiredConfig.systemPrompt;
      operations.operationCount++;
    }

    const desiredModel = desiredConfig.model || "google_ai/gemini-2.5-pro";
    if (currentAgent.model !== desiredModel) {
      fieldUpdates.model = desiredModel;
      operations.operationCount++;
    }

    const desiredEmbedding = desiredConfig.embedding || "letta/letta-free";
    if (currentAgent.embedding !== desiredEmbedding) {
      fieldUpdates.embedding = desiredEmbedding;
      operations.operationCount++;
    }

    const desiredContextWindow = desiredConfig.contextWindow || 64000;
    const currentContextWindow = (currentAgent as any).llm_config?.context_window || 64000;
    if (currentContextWindow !== desiredContextWindow) {
      fieldUpdates.context_window_limit = desiredContextWindow;
      operations.operationCount++;
    }

    if (Object.keys(fieldUpdates).length > 0) {
      operations.updateFields = fieldUpdates;
    }

    // Analyze tool changes
    operations.tools = await this.analyzeToolChanges(
      currentTools, 
      desiredConfig.tools || [], 
      toolRegistry,
      desiredConfig.toolSourceHashes || {}
    );
    operations.operationCount += operations.tools.toAdd.length + operations.tools.toRemove.length + operations.tools.toUpdate.length;

    // Analyze memory block changes
    operations.blocks = await this.analyzeBlockChanges(
      currentBlocks,
      [
        ...(desiredConfig.memoryBlocks || []),
        ...(desiredConfig.sharedBlocks || []).map(name => ({ name, isShared: true }))
      ],
      desiredConfig.memoryBlockFileHashes || {},
      existingAgent.name,
      sharedBlockIds
    );
    operations.operationCount += operations.blocks.toAdd.length + operations.blocks.toRemove.length + operations.blocks.toUpdate.length;

    // Analyze folder changes
    operations.folders = await this.analyzeFolderChanges(
      currentFolders,
      desiredConfig.folders || [],
      folderRegistry
    );
    operations.operationCount += operations.folders.toAttach.length + operations.folders.toDetach.length + 
      operations.folders.toUpdate.reduce((sum, folder) => sum + folder.filesToAdd.length + folder.filesToRemove.length + folder.filesToUpdate.length, 0);

    return operations;
  }

  private async analyzeToolChanges(
    currentTools: any[],
    desiredToolNames: string[],
    toolRegistry: Map<string, string>,
    toolSourceHashes: Record<string, string> = {}
  ): Promise<ToolDiff> {
    const currentToolNames = new Set(currentTools.map(t => t.name));
    const desiredToolSet = new Set(desiredToolNames);

    const toAdd: Array<{ name: string; id: string }> = [];
    const toRemove: Array<{ name: string; id: string }> = [];
    const toUpdate: Array<{ name: string; currentId: string; newId: string; reason: string }> = [];
    const unchanged: Array<{ name: string; id: string }> = [];

    // Find tools to add
    for (const toolName of desiredToolNames) {
      if (!currentToolNames.has(toolName)) {
        const toolId = toolRegistry.get(toolName);
        if (toolId) {
          toAdd.push({ name: toolName, id: toolId });
        }
      }
    }

    // Find tools to remove, update (source code changed), or leave unchanged
    for (const tool of currentTools) {
      if (desiredToolSet.has(tool.name)) {
        // Tool exists in both current and desired
        const toolName = tool.name;
        
        // Check if source code has changed for custom tools using the same pattern
        if (this.hasFileBasedContent(toolName, toolSourceHashes) && !['archival_memory_insert', 'archival_memory_search'].includes(toolName)) {
          // This tool has file-based source code, assume it might have changed and mark for update
          console.log(`Tool ${toolName} has file-based content, checking for updates...`);
          
          const currentToolId = tool.id;
          const newToolId = toolRegistry.get(toolName);
          
          if (newToolId && newToolId !== currentToolId) {
            // Tool was re-registered (source code actually changed)
            toUpdate.push({
              name: toolName,
              currentId: currentToolId,
              newId: newToolId,
              reason: 'source_code_changed'
            });
          } else {
            // Tool ID is same - fleet-parser already verified source hasn't changed
            unchanged.push({ name: toolName, id: currentToolId });
          }
        } else {
          unchanged.push({ name: tool.name, id: tool.id });
        }
      } else {
        // Tool exists in current but not desired - remove it
        toRemove.push({ name: tool.name, id: tool.id });
      }
    }

    return { toAdd, toRemove, toUpdate, unchanged };
  }

  private async analyzeBlockChanges(
    currentBlocks: any[],
    desiredBlocks: Array<{ name: string; isShared?: boolean; description?: string; limit?: number; value?: string }>,
    _memoryBlockFileHashes: Record<string, string> = {},
    agentName?: string,
    _sharedBlockIds?: Map<string, string>
  ): Promise<BlockDiff> {
    const currentBlockNames = new Set(currentBlocks.map(b => b.label));
    const desiredBlockNames = new Set(desiredBlocks.map(b => b.name));

    const toAdd: Array<{ name: string; id: string }> = [];
    const toRemove: Array<{ name: string; id: string }> = [];
    const toUpdate: Array<{ name: string; currentId: string; newId: string }> = [];
    const unchanged: Array<{ name: string; id: string }> = [];

    // Find blocks to add
    for (const blockConfig of desiredBlocks) {
      if (!currentBlockNames.has(blockConfig.name)) {
        let blockId = blockConfig.isShared
          ? this.blockManager.getSharedBlockId(blockConfig.name)
          : this.blockManager.getAgentBlockId(blockConfig.name);

        // If block doesn't exist yet, create it
        if (!blockId && !blockConfig.isShared && blockConfig.description && agentName) {
          console.log(`Creating new memory block: ${blockConfig.name} for agent ${agentName}`);
          blockId = await this.blockManager.getOrCreateAgentBlock(
            {
              name: blockConfig.name,
              description: blockConfig.description,
              limit: blockConfig.limit || 2000,
              value: blockConfig.value || ''
            },
            agentName
          );
        }

        if (blockId) {
          toAdd.push({ name: blockConfig.name, id: blockId });
        }
      }
    }

    // Find blocks to remove or mark as unchanged
    // Note: Block content updates are handled in-place by BlockManager, so we don't need toUpdate here
    for (const block of currentBlocks) {
      if (desiredBlockNames.has(block.label)) {
        unchanged.push({ name: block.label, id: block.id });
      } else {
        toRemove.push({ name: block.label, id: block.id });
      }
    }

    return { toAdd, toRemove, toUpdate, unchanged };
  }

  private async analyzeFolderChanges(
    currentFolders: any[],
    desiredFolders: Array<{ name: string; files: string[]; fileContentHashes?: Record<string, string> }>,
    folderRegistry: Map<string, string>
  ): Promise<FolderDiff> {
    const currentFolderNames = new Set(currentFolders.map(f => f.name));
    const desiredFolderNames = new Set(desiredFolders.map(f => f.name));

    const toAttach: Array<{ name: string; id: string }> = [];
    const toDetach: Array<{ name: string; id: string }> = [];
    const toUpdate: Array<{ 
      name: string; 
      id: string; 
      filesToAdd: string[]; 
      filesToRemove: string[]; 
      filesToUpdate: string[];
    }> = [];
    const unchanged: Array<{ name: string; id: string }> = [];

    // Find folders to attach (new folders)
    for (const folderConfig of desiredFolders) {
      if (!currentFolderNames.has(folderConfig.name)) {
        const folderId = folderRegistry.get(folderConfig.name);
        if (folderId) {
          toAttach.push({ name: folderConfig.name, id: folderId });
        }
      }
    }

    // Find folders to detach, update, or leave unchanged
    for (const folder of currentFolders) {
      if (desiredFolderNames.has(folder.name)) {
        // Folder exists in both current and desired - check for file changes
        const desiredFolder = desiredFolders.find(f => f.name === folder.name);
        
        if (desiredFolder && desiredFolder.fileContentHashes) {
          // Get current files in this folder from server
          try {
            const currentFilesResponse = await this.client.listFolderFiles(folder.id);
            const currentFiles = normalizeResponse(currentFilesResponse);
            const currentFileNames = new Set(currentFiles.map((f: any) => f.name || f.file_name || String(f)).filter(Boolean));
            const desiredFileNames = new Set(desiredFolder.files);
            
            const filesToAdd: string[] = [];
            const filesToRemove: string[] = [];
            const filesToUpdate: string[] = [];
            
            // Find files to add or update
            for (const filePath of desiredFolder.files) {
              const fileName = filePath.split('/').pop() || filePath; // Get just filename
              if (!currentFileNames.has(fileName)) {
                filesToAdd.push(filePath);
              } else {
                // File exists, check if content changed using the same pattern as memory blocks
                if (this.hasFileBasedContent(filePath, desiredFolder.fileContentHashes || {})) {
                  console.log(`File ${filePath} has file-based content, checking for updates...`);
                  filesToUpdate.push(filePath);
                }
              }
            }
            
            // Find files to remove  
            for (const currentFile of currentFiles) {
              const fileName = currentFile.name || currentFile.file_name || String(currentFile);
              if (fileName && !desiredFileNames.has(fileName)) {
                filesToRemove.push(fileName);
              }
            }
            
            if (filesToAdd.length > 0 || filesToRemove.length > 0 || filesToUpdate.length > 0) {
              toUpdate.push({
                name: folder.name,
                id: folder.id,
                filesToAdd,
                filesToRemove,
                filesToUpdate
              });
            } else {
              unchanged.push({ name: folder.name, id: folder.id });
            }
          } catch (error) {
            console.warn(`Could not analyze files in folder ${folder.name}:`, error);
            unchanged.push({ name: folder.name, id: folder.id });
          }
        } else {
          unchanged.push({ name: folder.name, id: folder.id });
        }
      } else {
        // Folder exists in current but not desired - detach it
        toDetach.push({ name: folder.name, id: folder.id });
      }
    }

    return { toAttach, toDetach, toUpdate, unchanged };
  }

  /**
   * Applies the update operations to the agent
   */
  async applyUpdateOperations(
    agentId: string,
    operations: AgentUpdateOperations,
    verbose: boolean = false
  ): Promise<void> {
    const applier = new DiffApplier(this.client, this.basePath);
    return applier.applyUpdateOperations(agentId, operations, verbose);
  }
}