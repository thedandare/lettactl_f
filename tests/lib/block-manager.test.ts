import { BlockManager } from '../../src/lib/block-manager';
import { LettaClientWrapper } from '../../src/lib/letta-client';

jest.mock('../../src/lib/letta-client');

describe('BlockManager', () => {
  let manager: BlockManager;
  let mockClient: jest.Mocked<LettaClientWrapper>;

  beforeEach(() => {
    mockClient = new (LettaClientWrapper as any)();
    manager = new BlockManager(mockClient);
  });

  describe('hashing', () => {
    const hash = (content: string) => (manager as any).generateContentHash(content);

    it('is deterministic and unique', () => {
      expect(hash('a')).toBe(hash('a'));
      expect(hash('a')).not.toBe(hash('b'));
    });
  });

  describe('version parsing', () => {
    const parse = (label: string) => (manager as any).parseVersionFromLabel(label);

    it('extracts version or returns initial', () => {
      expect(parse('block__v__v1')).toBe('v1');
      expect(parse('block')).toBe('initial');
    });
  });

  describe('getBlockKey', () => {
    const key = (name: string, shared: boolean) => (manager as any).getBlockKey(name, shared);

    it('handles shared prefix and strips versions', () => {
      expect(key('block', true)).toBe('shared:block');
      expect(key('block', false)).toBe('block');
      expect(key('block__v__v1', false)).toBe('block');
    });
  });

  describe('createVersionedLabel', () => {
    const label = (name: string, version: string, first: boolean) =>
      (manager as any).createVersionedLabel(name, version, first);

    it('creates correct labels', () => {
      expect(label('block', 'v1', false)).toBe('block__v__v1');
      expect(label('block', 'initial', true)).toBe('block');
    });
  });

  describe('getOrCreateSharedBlock', () => {
    it('creates block with correct params', async () => {
      mockClient.listBlocks.mockResolvedValue([] as any);
      mockClient.createBlock.mockResolvedValue({ id: 'id-1' } as any);
      await manager.loadExistingBlocks();

      await manager.getOrCreateSharedBlock({ name: 'test', description: 'desc', limit: 1000, value: 'val' });

      expect(mockClient.createBlock).toHaveBeenCalledWith({
        label: 'test', description: 'desc', value: 'val', limit: 1000
      });
    });
  });
});
