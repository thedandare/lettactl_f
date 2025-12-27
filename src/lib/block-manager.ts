import { LettaClientWrapper } from './letta-client';
import { normalizeResponse } from './response-normalizer';
import { generateContentHash, generateTimestampVersion } from '../utils/hash-utils';

export interface BlockVersion {
  id: string;
  label: string;
  description: string;
  value: string;
  limit: number;
  contentHash: string;
  version: string; // Now stores the actual version string (user-defined or auto-generated)
  isShared: boolean;
  lastUpdated: string;
  userDefined: boolean; // Whether version was user-specified
}

export class BlockManager {
  private client: LettaClientWrapper;
  private blockRegistry = new Map<string, BlockVersion>();

  constructor(client: LettaClientWrapper) {
    this.client = client;
  }

  /**
   * Loads existing blocks from the server and builds the registry
   */
  async loadExistingBlocks(): Promise<void> {
    const blocks = await this.client.listBlocks();
    const blockList = normalizeResponse(blocks);

    for (const block of blockList) {
      if (block.label && block.value) {
        const contentHash = generateContentHash(block.value);
        const version = this.parseVersionFromLabel(block.label);
        const isShared = block.label.startsWith('shared_');

        const blockVersion: BlockVersion = {
          id: block.id,
          label: block.label,
          description: block.description || '',
          value: block.value,
          limit: block.limit || 0,
          contentHash,
          version,
          isShared,
          lastUpdated: block.updated_at || new Date().toISOString(),
          userDefined: false // We can't know if existing blocks had user-defined versions
        };

        this.blockRegistry.set(this.getBlockKey(block.label, isShared), blockVersion);
      }
    }
  }

  /**
   * Parses version string from block label (e.g., "block_name__v__20241202-a1b2c3d4" -> "20241202-a1b2c3d4")
   */
  private parseVersionFromLabel(label: string): string {
    const versionMatch = label.match(/__v__(.+)$/);
    return versionMatch ? versionMatch[1] : 'initial';
  }

  /**
   * Gets the registry key for a block
   */
  private getBlockKey(baseName: string, isShared: boolean): string {
    const cleanName = baseName.replace(/__v__.+$/, ''); // Remove version suffix
    return isShared ? `shared:${cleanName}` : cleanName;
  }

  /**
   * Validates and sanitizes user-defined version tags
   */
  private validateUserVersion(version: string): string {
    // Remove spaces, convert to lowercase, replace invalid chars with dashes
    return version.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '-');
  }

  /**
   * Creates a versioned block label
   */
  private createVersionedLabel(baseName: string, version: string, isFirstVersion: boolean = false): string {
    return isFirstVersion && version === 'initial' ? baseName : `${baseName}__v__${version}`;
  }

  /**
   * Gets or creates a shared block, with enhanced versioning support
   */
  async getOrCreateSharedBlock(blockConfig: any): Promise<string> {
    const blockKey = this.getBlockKey(blockConfig.name, true);
    const contentHash = generateContentHash(blockConfig.value);
    // Check both shared and non-shared keys (blocks loaded from server may not have shared_ prefix)
    let existing = this.blockRegistry.get(blockKey);
    if (!existing) {
      existing = this.blockRegistry.get(this.getBlockKey(blockConfig.name, false));
    }

    // Determine version strategy
    let newVersion: string;
    let userDefined = false;
    
    if (blockConfig.version) {
      newVersion = this.validateUserVersion(blockConfig.version);
      userDefined = true;
    } else {
      newVersion = existing ? generateTimestampVersion(contentHash) : 'initial';
    }

    if (existing) {
      // Check if content has changed or user wants a specific version
      if (existing.contentHash === contentHash && !blockConfig.version) {
        console.log(`Using existing shared block: ${existing.label}`);
        return existing.id;
      } else {
        // Content changed or user specified version
        const newLabel = this.createVersionedLabel(blockConfig.name, newVersion);
        
        const reason = blockConfig.version 
          ? `user tagged as '${newVersion}'` 
          : `content changed (${newVersion})`;
        console.log(`Creating shared block ${newLabel} (${reason}, was ${existing.label})`);
        
        const newBlock = await this.client.createBlock({
          label: newLabel,
          description: blockConfig.description,
          value: blockConfig.value,
          limit: blockConfig.limit
        });

        const blockVersion: BlockVersion = {
          id: newBlock.id,
          label: newLabel,
          description: blockConfig.description,
          value: blockConfig.value,
          limit: blockConfig.limit,
          contentHash,
          version: newVersion,
          isShared: true,
          lastUpdated: new Date().toISOString(),
          userDefined
        };

        this.blockRegistry.set(blockKey, blockVersion);
        return newBlock.id;
      }
    } else {
      // Create new shared block
      const isFirstVersion = newVersion === 'initial';
      const newLabel = this.createVersionedLabel(blockConfig.name, newVersion, isFirstVersion);
      
      console.log(`Creating new shared block: ${newLabel}${userDefined ? ` (tagged: ${newVersion})` : ''}`);
      
      const newBlock = await this.client.createBlock({
        label: newLabel,
        description: blockConfig.description,
        value: blockConfig.value,
        limit: blockConfig.limit
      });

      const blockVersion: BlockVersion = {
        id: newBlock.id,
        label: newLabel,
        description: blockConfig.description,
        value: blockConfig.value,
        limit: blockConfig.limit,
        contentHash,
        version: newVersion,
        isShared: true,
        lastUpdated: new Date().toISOString(),
        userDefined
      };

      this.blockRegistry.set(blockKey, blockVersion);
      return newBlock.id;
    }
  }

  /**
   * Gets or creates an agent-specific block with enhanced versioning
   */
  async getOrCreateAgentBlock(blockConfig: any, agentName: string): Promise<string> {
    const fullBlockName = `${blockConfig.name}`;
    const blockKey = this.getBlockKey(fullBlockName, false);
    const contentHash = generateContentHash(blockConfig.value);
    const existing = this.blockRegistry.get(blockKey);

    // Determine version strategy
    let newVersion: string;
    let userDefined = false;
    
    if (blockConfig.version) {
      newVersion = this.validateUserVersion(blockConfig.version);
      userDefined = true;
    } else {
      newVersion = existing ? generateTimestampVersion(contentHash) : 'initial';
    }

    if (existing) {
      // Check if content has changed or user wants a specific version
      if (existing.contentHash === contentHash && !blockConfig.version) {
        console.log(`Using existing block: ${existing.label}`);
        return existing.id;
      } else {
        // Content changed or user specified version
        const newLabel = this.createVersionedLabel(fullBlockName, newVersion);
        
        const reason = blockConfig.version 
          ? `user tagged as '${newVersion}'` 
          : `content changed (${newVersion})`;
        console.log(`Creating block ${newLabel} (${reason}, was ${existing.label})`);
        
        const newBlock = await this.client.createBlock({
          label: newLabel,
          description: blockConfig.description,
          value: blockConfig.value,
          limit: blockConfig.limit
        });

        const blockVersion: BlockVersion = {
          id: newBlock.id,
          label: newLabel,
          description: blockConfig.description,
          value: blockConfig.value,
          limit: blockConfig.limit,
          contentHash,
          version: newVersion,
          isShared: false,
          lastUpdated: new Date().toISOString(),
          userDefined
        };

        this.blockRegistry.set(blockKey, blockVersion);
        return newBlock.id;
      }
    } else {
      // Create new agent block
      const isFirstVersion = newVersion === 'initial';
      const newLabel = this.createVersionedLabel(fullBlockName, newVersion, isFirstVersion);
      
      console.log(`Creating new block: ${newLabel}${userDefined ? ` (tagged: ${newVersion})` : ''}`);
      
      const newBlock = await this.client.createBlock({
        label: newLabel,
        description: blockConfig.description,
        value: blockConfig.value,
        limit: blockConfig.limit
      });

      const blockVersion: BlockVersion = {
        id: newBlock.id,
        label: newLabel,
        description: blockConfig.description,
        value: blockConfig.value,
        limit: blockConfig.limit,
        contentHash,
        version: newVersion,
        isShared: false,
        lastUpdated: new Date().toISOString(),
        userDefined
      };

      this.blockRegistry.set(blockKey, blockVersion);
      return newBlock.id;
    }
  }

  /**
   * Gets the shared block ID by name
   */
  getSharedBlockId(blockName: string): string | null {
    // Check both shared and non-shared keys
    let existing = this.blockRegistry.get(this.getBlockKey(blockName, true));
    if (!existing) {
      existing = this.blockRegistry.get(this.getBlockKey(blockName, false));
    }
    return existing ? existing.id : null;
  }

  /**
   * Gets agent block ID by name if it exists
   */
  getAgentBlockId(blockName: string): string | null {
    const blockKey = this.getBlockKey(blockName, false);
    const existing = this.blockRegistry.get(blockKey);
    return existing ? existing.id : null;
  }

  /**
   * Lists all block versions for debugging/reporting
   */
  getBlockRegistry(): Map<string, BlockVersion> {
    return new Map(this.blockRegistry);
  }
}