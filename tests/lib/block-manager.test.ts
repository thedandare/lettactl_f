import { BlockManager } from '../../src/lib/block-manager';
import { LettaClientWrapper } from '../../src/lib/letta-client';

// Mock LettaClientWrapper
jest.mock('../../src/lib/letta-client');
const MockedLettaClient = LettaClientWrapper as jest.MockedClass<typeof LettaClientWrapper>;

describe('BlockManager', () => {
  let blockManager: BlockManager;
  let mockClient: jest.Mocked<LettaClientWrapper>;

  beforeEach(() => {
    mockClient = new MockedLettaClient() as jest.Mocked<LettaClientWrapper>;
    blockManager = new BlockManager(mockClient);
    jest.clearAllMocks();
  });

  describe('loadExistingBlocks', () => {
    it('should load and organize existing blocks', async () => {
      const mockBlocks = [
        {
          id: 'block-1',
          label: 'test-block',
          description: 'Test block',
          value: 'Test content',
          limit: 1000
        },
        {
          id: 'block-2',
          label: 'shared_block__v__20241202-abc123',
          description: 'Shared block',
          value: 'Shared content',
          limit: 2000
        }
      ];

      mockClient.listBlocks.mockResolvedValue(mockBlocks as any);

      await blockManager.loadExistingBlocks();

      expect(mockClient.listBlocks).toHaveBeenCalledTimes(1);
      // Block manager should have processed the blocks internally
    });
  });

  describe('getOrCreateSharedBlock', () => {
    beforeEach(async () => {
      mockClient.listBlocks.mockResolvedValue([] as any);
      await blockManager.loadExistingBlocks();
    });

    it('should create a new shared block', async () => {
      const blockConfig = {
        name: 'test-block',
        description: 'Test shared block',
        limit: 5000,
        value: 'Test content'
      };

      const mockCreatedBlock = {
        id: 'block-123',
        label: 'shared_test-block__v__20241202-abc123',
        description: blockConfig.description,
        limit: blockConfig.limit,
        value: blockConfig.value
      };

      mockClient.createBlock.mockResolvedValue(mockCreatedBlock);

      const blockId = await blockManager.getOrCreateSharedBlock(blockConfig);

      expect(blockId).toBe('block-123');
      expect(mockClient.createBlock).toHaveBeenCalledWith({
        label: 'test-block', // First version gets no suffix
        description: blockConfig.description,
        value: blockConfig.value,
        limit: blockConfig.limit
      });
    });

    it('should use user-defined version when provided', async () => {
      const blockConfig = {
        name: 'test-block',
        description: 'Test shared block',
        limit: 5000,
        value: 'Test content',
        version: 'custom-v1'
      };

      const mockCreatedBlock = {
        id: 'block-123',
        label: 'shared_test-block__v__custom-v1',
        value: 'Test content',
        description: 'Test shared block',
        limit: 5000
      };

      mockClient.createBlock.mockResolvedValue(mockCreatedBlock);

      await blockManager.getOrCreateSharedBlock(blockConfig);

      expect(mockClient.createBlock).toHaveBeenCalledWith({
        label: 'test-block__v__custom-v1',
        description: blockConfig.description,
        value: blockConfig.value,
        limit: blockConfig.limit
      });
    });
  });

  describe('version generation', () => {
    it('should generate consistent timestamp versions', () => {
      const content1 = 'Same content';
      const content2 = 'Same content';
      
      // Access private method for testing
      const generateTimestampVersion = (blockManager as any).generateTimestampVersion.bind(blockManager);
      const generateContentHash = (blockManager as any).generateContentHash.bind(blockManager);
      
      const hash1 = generateContentHash(content1);
      const hash2 = generateContentHash(content2);
      
      expect(hash1).toBe(hash2);
      
      const version1 = generateTimestampVersion(hash1);
      const version2 = generateTimestampVersion(hash2);
      
      expect(version1).toBe(version2);
      expect(version1).toMatch(/^\d{8}-[a-f0-9]{8}$/);
    });
  });
});