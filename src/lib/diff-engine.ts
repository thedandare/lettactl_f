import { LettaClientWrapper } from './letta-client';
import { AgentVersion } from './agent-manager';
import { BlockManager } from './block-manager';
import { normalizeResponse } from './response-normalizer';

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
    systemPrompt?: string;
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
      folders?: Array<{name: string; files: string[]}>;
      sharedBlocks?: string[];
    },
    toolRegistry: Map<string, string>,
    folderRegistry: Map<string, string>,
    verbose: boolean = false
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
      fieldUpdates.systemPrompt = desiredConfig.systemPrompt;
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
      ]
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
        
        // Check if source code has changed for custom tools
        if (toolSourceHashes[toolName] && !['archival_memory_insert', 'archival_memory_search'].includes(toolName)) {
          // For tools with source code, we need to check if the source has changed
          // This would require getting the current tool's source hash and comparing
          // For now, we'll re-register tools when their source files exist and have hashes
          const currentToolId = tool.id;
          const newToolId = toolRegistry.get(toolName);
          
          if (newToolId && newToolId !== currentToolId) {
            // Tool was re-registered (likely due to source code change)
            toUpdate.push({ 
              name: toolName, 
              currentId: currentToolId, 
              newId: newToolId, 
              reason: 'source_code_changed' 
            });
          } else {
            unchanged.push({ name: tool.name, id: tool.id });
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
    desiredBlocks: Array<{ name: string; isShared?: boolean }>
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
        const blockId = blockConfig.isShared 
          ? this.blockManager.getSharedBlockId(blockConfig.name)
          : this.blockManager.getSharedBlockId(blockConfig.name); // TODO: Add agent block lookup
        
        if (blockId) {
          toAdd.push({ name: blockConfig.name, id: blockId });
        }
      }
    }

    // Find blocks to remove and unchanged
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
                // File exists, check if content changed
                // For now, assume content may have changed if folder hash changed
                if (desiredFolder.fileContentHashes && desiredFolder.fileContentHashes[filePath]) {
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
    if (operations.operationCount === 0) {
      if (verbose) console.log('  No changes needed');
      return;
    }

    if (verbose) console.log(`  Applying ${operations.operationCount} updates (preserves conversation: ${operations.preservesConversation})`);

    // Apply field updates
    if (operations.updateFields) {
      if (verbose) console.log('  Updating agent fields...');
      await this.client.updateAgent(agentId, operations.updateFields);
    }

    // Apply tool changes
    if (operations.tools) {
      for (const tool of operations.tools.toAdd) {
        if (verbose) console.log(`  Attaching tool: ${tool.name}`);
        await this.client.attachToolToAgent(agentId, tool.id);
      }
      
      for (const tool of operations.tools.toUpdate) {
        if (verbose) console.log(`  Updating tool: ${tool.name} (${tool.reason})`);
        // Detach old version and attach new version
        await this.client.detachToolFromAgent(agentId, tool.currentId);
        await this.client.attachToolToAgent(agentId, tool.newId);
      }
      
      for (const tool of operations.tools.toRemove) {
        if (verbose) console.log(`  Detaching tool: ${tool.name}`);
        await this.client.detachToolFromAgent(agentId, tool.id);
      }
    }

    // Apply block changes
    if (operations.blocks) {
      for (const block of operations.blocks.toAdd) {
        if (verbose) console.log(`  Attaching block: ${block.name}`);
        await this.client.attachBlockToAgent(agentId, block.id);
      }
      
      for (const block of operations.blocks.toRemove) {
        if (verbose) console.log(`  Detaching block: ${block.name}`);
        await this.client.detachBlockFromAgent(agentId, block.id);
      }
      
      for (const block of operations.blocks.toUpdate) {
        if (verbose) console.log(`  Updating block: ${block.name}`);
        // First detach old, then attach new
        await this.client.detachBlockFromAgent(agentId, block.currentId);
        await this.client.attachBlockToAgent(agentId, block.newId);
      }
    }

    // Apply folder changes
    if (operations.folders) {
      for (const folder of operations.folders.toAttach) {
        if (verbose) console.log(`  Attaching folder: ${folder.name}`);
        await this.client.attachFolderToAgent(agentId, folder.id);
      }
      
      for (const folder of operations.folders.toDetach) {
        if (verbose) console.log(`  Detaching folder: ${folder.name}`);
        await this.client.detachFolderFromAgent(agentId, folder.id);
      }
      
      for (const folder of operations.folders.toUpdate) {
        if (verbose) console.log(`  Updating folder: ${folder.name}`);
        
        // Add new files to the folder
        for (const filePath of folder.filesToAdd) {
          try {
            if (verbose) console.log(`    Adding file: ${filePath}`);
            await this.addFileToFolder(folder.id, filePath);
          } catch (error) {
            console.error(`    Failed to add file ${filePath}:`, (error as Error).message);
          }
        }
        
        // Remove files from the folder
        for (const fileName of folder.filesToRemove) {
          try {
            if (verbose) console.log(`    Removing file: ${fileName}`);
            await this.removeFileFromFolder(folder.id, fileName);
          } catch (error) {
            console.error(`    Failed to remove file ${fileName}:`, (error as Error).message);
          }
        }
        
        // Update existing files in the folder
        for (const filePath of folder.filesToUpdate) {
          try {
            if (verbose) console.log(`    Updating file: ${filePath}`);
            await this.updateFileInFolder(folder.id, filePath);
          } catch (error) {
            console.error(`    Failed to update file ${filePath}:`, (error as Error).message);
          }
        }
      }
    }

    if (verbose) console.log('  Updates completed successfully');
  }

  /**
   * Helper method to add a file to an existing folder
   */
  private async addFileToFolder(folderId: string, filePath: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    
    const fullPath = path.resolve(this.basePath, filePath);
    const fileName = path.basename(filePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }
    
    const fileStream = fs.createReadStream(fullPath);
    await this.client.uploadFileToFolder(fileStream, folderId, fileName);
  }

  /**
   * Helper method to remove a file from a folder
   */
  private async removeFileFromFolder(folderId: string, fileName: string): Promise<void> {
    // Get the file ID by name
    const fileId = await this.client.getFileIdByName(folderId, fileName);
    
    if (!fileId) {
      throw new Error(`File not found in folder: ${fileName}`);
    }
    
    // Delete the file using the SDK
    await this.client.deleteFileFromFolder(folderId, fileId);
  }

  /**
   * Helper method to update an existing file in a folder
   */
  private async updateFileInFolder(folderId: string, filePath: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    
    const fullPath = path.resolve(this.basePath, filePath);
    const fileName = path.basename(filePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }
    
    // For file updates, we re-upload the file
    // This may overwrite the existing file or create a duplicate
    const fileStream = fs.createReadStream(fullPath);
    await this.client.uploadFileToFolder(fileStream, folderId, fileName);
  }
}