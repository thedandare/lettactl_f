import { AgentManager } from '../../src/lib/agent-manager';
import { LettaClientWrapper } from '../../src/lib/letta-client';

// Mock LettaClientWrapper
jest.mock('../../src/lib/letta-client');
const MockedLettaClient = LettaClientWrapper as jest.MockedClass<typeof LettaClientWrapper>;

describe('AgentManager', () => {
  let agentManager: AgentManager;
  let mockClient: jest.Mocked<LettaClientWrapper>;

  beforeEach(() => {
    mockClient = new MockedLettaClient() as jest.Mocked<LettaClientWrapper>;
    agentManager = new AgentManager(mockClient);
    jest.clearAllMocks();
  });

  describe('getOrCreateAgentName', () => {
    beforeEach(async () => {
      mockClient.listAgents.mockResolvedValue([] as any);
      await agentManager.loadExistingAgents();
    });

    it('should create new agent when none exists', async () => {
      const result = await agentManager.getOrCreateAgentName(
        'test-agent',
        'You are a test agent',
        false
      );

      expect(result.agentName).toBe('test-agent');
      expect(result.shouldCreate).toBe(true);
      expect(result.existingAgent).toBeUndefined();
    });

    it('should reuse existing agent with same system prompt', async () => {
      const mockAgents = [
        {
          id: 'agent-123',
          name: 'test-agent',
          system: 'You are a test agent',
          last_updated: '2023-01-01T00:00:00Z',
          agent_type: 'memgpt_agent',
          blocks: [],
          embedding_config: {},
          llm_config: {},
          memory: {},
          created_at: '2023-01-01T00:00:00Z',
          tools: []
        }
      ];

      mockClient.listAgents.mockResolvedValue(mockAgents as any);
      await agentManager.loadExistingAgents();

      const result = await agentManager.getOrCreateAgentName(
        'test-agent',
        'You are a test agent',
        false
      );

      expect(result.agentName).toBe('test-agent');
      expect(result.shouldCreate).toBe(false);
      expect(result.existingAgent).toBeDefined();
    });

    it('should create versioned agent when system prompt changes', async () => {
      const mockAgents = [
        {
          id: 'agent-123',
          name: 'test-agent',
          system: 'You are a test agent',
          last_updated: '2023-01-01T00:00:00Z',
          agent_type: 'memgpt_agent',
          blocks: [],
          embedding_config: {},
          llm_config: {},
          memory: {},
          created_at: '2023-01-01T00:00:00Z',
          tools: []
        }
      ];

      mockClient.listAgents.mockResolvedValue(mockAgents as any);
      await agentManager.loadExistingAgents();

      const result = await agentManager.getOrCreateAgentName(
        'test-agent',
        'You are an updated test agent',
        false
      );

      expect(result.agentName).toMatch(/^test-agent__v__\d{8}-[a-f0-9]{8}$/);
      expect(result.shouldCreate).toBe(true);
      expect(result.existingAgent).toBeUndefined();
    });

    it('should handle versioned agent names', async () => {
      const mockAgents = [
        {
          id: 'agent-123',
          name: 'test-agent__v__20241201-abc12345',
          system: 'You are a test agent',
          last_updated: '2023-01-01T00:00:00Z',
          agent_type: 'memgpt_agent',
          blocks: [],
          embedding_config: {},
          llm_config: {},
          memory: {},
          created_at: '2023-01-01T00:00:00Z',
          tools: []
        }
      ];

      mockClient.listAgents.mockResolvedValue(mockAgents as any);
      await agentManager.loadExistingAgents();

      const result = await agentManager.getOrCreateAgentName(
        'test-agent',
        'You are a test agent',
        false
      );

      expect(result.agentName).toBe('test-agent__v__20241201-abc12345');
      expect(result.shouldCreate).toBe(false);
    });
  });

  describe('updateRegistry', () => {
    it('should update registry with new agent', () => {
      agentManager.updateRegistry(
        'test-agent__v__20241202-def67890',
        'You are a test agent',
        'agent-456'
      );

      const versions = agentManager.getAgentVersions('test-agent');
      expect(versions).toHaveLength(1);
      expect(versions[0].name).toBe('test-agent__v__20241202-def67890');
      expect(versions[0].baseName).toBe('test-agent');
    });
  });

  describe('version parsing', () => {
    it('should parse versioned agent names correctly', () => {
      const parseVersionFromName = (agentManager as any).parseVersionFromName.bind(agentManager);
      
      const result1 = parseVersionFromName('test-agent__v__20241202-abc123ef');
      expect(result1.baseName).toBe('test-agent');
      expect(result1.version).toBe('20241202-abc123ef');
      
      const result2 = parseVersionFromName('simple-agent');
      expect(result2.baseName).toBe('simple-agent');
      expect(result2.version).toBeNull();
    });
  });
});