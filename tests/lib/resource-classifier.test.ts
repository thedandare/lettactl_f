import { ResourceClassifier } from '../../src/lib/resource-classifier';
import { LettaClientWrapper } from '../../src/lib/letta-client';

// Mock LettaClientWrapper
jest.mock('../../src/lib/letta-client');
const MockedLettaClient = LettaClientWrapper as jest.MockedClass<typeof LettaClientWrapper>;

describe('ResourceClassifier', () => {
  let classifier: ResourceClassifier;
  let mockClient: jest.Mocked<LettaClientWrapper>;

  beforeEach(() => {
    mockClient = new MockedLettaClient() as jest.Mocked<LettaClientWrapper>;
    classifier = new ResourceClassifier(mockClient);
    jest.clearAllMocks();
  });

  describe('isSharedFolder', () => {
    it('should identify shared folders', () => {
      expect(classifier.isSharedFolder({ name: 'shared-docs' })).toBe(true);
      expect(classifier.isSharedFolder({ name: 'my-shared-folder' })).toBe(true);
      expect(classifier.isSharedFolder({ name: 'sharedfiles' })).toBe(true);
    });

    it('should identify non-shared folders', () => {
      expect(classifier.isSharedFolder({ name: 'agent-specific' })).toBe(false);
      expect(classifier.isSharedFolder({ name: 'private-docs' })).toBe(false);
      expect(classifier.isSharedFolder({ name: 'my-folder' })).toBe(false);
    });

    it('should handle folders without name', () => {
      expect(classifier.isSharedFolder({})).toBe(false);
      expect(classifier.isSharedFolder({ name: null })).toBe(false);
      expect(classifier.isSharedFolder({ name: '' })).toBe(false);
    });
  });

  describe('isSharedBlock', () => {
    it('should identify shared blocks', () => {
      expect(classifier.isSharedBlock({ label: 'shared_block_1' })).toBe(true);
      expect(classifier.isSharedBlock({ label: 'shared_memory' })).toBe(true);
    });

    it('should identify non-shared blocks', () => {
      expect(classifier.isSharedBlock({ label: 'agent_memory' })).toBe(false);
      expect(classifier.isSharedBlock({ label: 'private_block' })).toBe(false);
      expect(classifier.isSharedBlock({ label: 'my_shared_but_not_prefix' })).toBe(false);
    });

    it('should handle blocks without label', () => {
      expect(classifier.isSharedBlock({})).toBe(false);
      expect(classifier.isSharedBlock({ label: null })).toBe(false);
      expect(classifier.isSharedBlock({ label: '' })).toBe(false);
    });
  });

  describe('isFolderUsedByOtherAgents', () => {
    it('should return true when folder is used by other agents', async () => {
      const allAgents = [
        { id: 'agent-1' },
        { id: 'agent-2' },
        { id: 'agent-3' }
      ];

      mockClient.getAgent
        .mockResolvedValueOnce({ folders: [{ id: 'folder-123' }] } as any) // agent-2
        .mockResolvedValueOnce({ folders: [] } as any); // agent-3

      const result = await classifier.isFolderUsedByOtherAgents('folder-123', 'agent-1', allAgents);
      
      expect(result).toBe(true);
      expect(mockClient.getAgent).toHaveBeenCalledWith('agent-2');
      // Should not call agent-3 since it found match in agent-2
    });

    it('should return false when folder is not used by other agents', async () => {
      const allAgents = [
        { id: 'agent-1' },
        { id: 'agent-2' }
      ];

      mockClient.getAgent.mockResolvedValue({ folders: [] } as any);

      const result = await classifier.isFolderUsedByOtherAgents('folder-123', 'agent-1', allAgents);
      
      expect(result).toBe(false);
    });

    it('should handle errors when getting agent details', async () => {
      const allAgents = [{ id: 'agent-1' }, { id: 'agent-2' }];

      mockClient.getAgent.mockRejectedValue(new Error('Agent not found'));

      const result = await classifier.isFolderUsedByOtherAgents('folder-123', 'agent-1', allAgents);
      
      expect(result).toBe(false);
    });
  });

  describe('getAgentSpecificBlocks', () => {
    it('should identify agent-specific blocks', () => {
      const blocks = [
        { label: 'test-agent_memory' },
        { label: 'memory_test-agent' },
        { label: 'test-agent' },
        { label: 'shared_block' },
        { label: 'other-agent_memory' },
        { label: 'generic_block' }
      ];

      const result = classifier.getAgentSpecificBlocks(blocks, 'test-agent');
      
      expect(result).toHaveLength(3);
      expect(result.map(b => b.label)).toContain('test-agent_memory');
      expect(result.map(b => b.label)).toContain('memory_test-agent');
      expect(result.map(b => b.label)).toContain('test-agent');
      expect(result.map(b => b.label)).not.toContain('shared_block');
      expect(result.map(b => b.label)).not.toContain('other-agent_memory');
    });

    it('should exclude shared blocks', () => {
      const blocks = [
        { label: 'shared_test-agent_block' },
        { label: 'test-agent_private' }
      ];

      const result = classifier.getAgentSpecificBlocks(blocks, 'test-agent');
      
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('test-agent_private');
    });

    it('should handle normalized response format', () => {
      const blocksResponse = { items: [
        { label: 'test-agent_memory' }
      ]};

      const result = classifier.getAgentSpecificBlocks(blocksResponse as any, 'test-agent');
      
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('test-agent_memory');
    });

    it('should handle blocks without labels', () => {
      const blocks = [
        { label: 'test-agent_memory' },
        {}, // no label
        { label: null },
        { label: '' }
      ];

      const result = classifier.getAgentSpecificBlocks(blocks, 'test-agent');
      
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('test-agent_memory');
    });
  });
});