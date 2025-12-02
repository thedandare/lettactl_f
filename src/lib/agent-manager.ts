import { LettaClientWrapper } from './letta-client';
import { normalizeResponse } from './response-normalizer';
import * as crypto from 'crypto';

export interface AgentVersion {
  id: string;
  name: string;
  baseName: string; // Name without version suffix
  systemPromptHash: string;
  version: string;
  lastUpdated: string;
}

export class AgentManager {
  private client: LettaClientWrapper;
  private agentRegistry = new Map<string, AgentVersion>();

  constructor(client: LettaClientWrapper) {
    this.client = client;
  }

  /**
   * Generates a content hash for system prompt versioning
   */
  private generateContentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Generates a timestamp-based version for system prompt changes
   */
  private generateTimestampVersion(contentHash: string): string {
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const shortHash = contentHash.substring(0, 8);
    return `${timestamp}-${shortHash}`;
  }

  /**
   * Parses version from agent name (e.g., "recipe-assistant__v__20241202-abc123ef")
   */
  private parseVersionFromName(agentName: string): { baseName: string; version: string | null } {
    const versionMatch = agentName.match(/^(.+)__v__(.+)$/);
    if (versionMatch) {
      return { baseName: versionMatch[1], version: versionMatch[2] };
    }
    return { baseName: agentName, version: null };
  }

  /**
   * Loads existing agents from the server and builds the registry
   */
  async loadExistingAgents(): Promise<void> {
    const agents = await this.client.listAgents();
    const agentList = normalizeResponse(agents);

    for (const agent of agentList) {
      if (agent.name && agent.system) {
        const systemPromptHash = this.generateContentHash(agent.system);
        const { baseName, version } = this.parseVersionFromName(agent.name);

        const agentVersion: AgentVersion = {
          id: agent.id,
          name: agent.name,
          baseName: baseName,
          systemPromptHash: systemPromptHash,
          version: version || 'latest',
          lastUpdated: agent.last_updated || new Date().toISOString()
        };

        // Store by base name for lookup
        const existingAgent = this.agentRegistry.get(baseName);
        if (!existingAgent || agentVersion.lastUpdated > existingAgent.lastUpdated) {
          this.agentRegistry.set(baseName, agentVersion);
        }
      }
    }
  }

  /**
   * Determines if an agent needs to be created/updated based on system prompt changes
   */
  async getOrCreateAgentName(
    baseName: string, 
    systemPrompt: string, 
    verbose: boolean = false
  ): Promise<{ agentName: string; shouldCreate: boolean; existingAgent?: AgentVersion }> {
    
    const systemPromptHash = this.generateContentHash(systemPrompt);
    const existingAgent = this.agentRegistry.get(baseName);

    if (!existingAgent) {
      // No agent with this base name exists
      if (verbose) console.log(`  No existing agent found for: ${baseName}`);
      return { 
        agentName: baseName, 
        shouldCreate: true 
      };
    }

    // Check if system prompt has changed
    if (existingAgent.systemPromptHash === systemPromptHash) {
      // System prompt unchanged, use existing agent
      if (verbose) console.log(`  Using existing agent: ${existingAgent.name} (unchanged system prompt)`);
      return { 
        agentName: existingAgent.name, 
        shouldCreate: false, 
        existingAgent 
      };
    }

    // System prompt changed, create new versioned agent
    const newVersion = this.generateTimestampVersion(systemPromptHash);
    const newAgentName = `${baseName}__v__${newVersion}`;
    
    if (verbose) console.log(`  System prompt changed for: ${baseName}`);
    if (verbose) console.log(`  Creating new versioned agent: ${newAgentName}`);
    
    return { 
      agentName: newAgentName, 
      shouldCreate: true 
    };
  }

  /**
   * Updates the registry after creating a new agent
   */
  updateRegistry(agentName: string, systemPrompt: string, agentId: string): void {
    const systemPromptHash = this.generateContentHash(systemPrompt);
    const { baseName, version } = this.parseVersionFromName(agentName);

    const agentVersion: AgentVersion = {
      id: agentId,
      name: agentName,
      baseName: baseName,
      systemPromptHash: systemPromptHash,
      version: version || 'latest',
      lastUpdated: new Date().toISOString()
    };

    this.agentRegistry.set(baseName, agentVersion);
  }

  /**
   * Gets all agents with the same base name (for cleanup/management)
   */
  getAgentVersions(baseName: string): AgentVersion[] {
    const versions: AgentVersion[] = [];
    for (const agent of this.agentRegistry.values()) {
      if (agent.baseName === baseName) {
        versions.push(agent);
      }
    }
    return versions.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  }
}