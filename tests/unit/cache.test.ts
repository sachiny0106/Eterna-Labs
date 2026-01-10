import { MemoryCache } from '../../src/services/cache';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  afterEach(async () => {
    await cache.flush();
  });

  describe('Basic Operations', () => {
    it('should set and get a value', async () => {
      await cache.set('test-key', { name: 'test', value: 123 });
      
      const result = await cache.get<{ name: string; value: number }>('test-key');
      
      expect(result).toEqual({ name: 'test', value: 123 });
    });

    it('should return null for non-existent key', async () => {
      const result = await cache.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete a key', async () => {
      await cache.set('to-delete', 'value');
      await cache.delete('to-delete');
      
      const result = await cache.get('to-delete');
      expect(result).toBeNull();
    });

    it('should check if key exists', async () => {
      await cache.set('existing-key', 'value');
      
      expect(await cache.exists('existing-key')).toBe(true);
      expect(await cache.exists('non-existing')).toBe(false);
    });

    it('should flush all keys', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.flush();
      
      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBeNull();
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      await cache.set('expiring', 'value', 1); // 1 second TTL
      
      // Should exist immediately
      expect(await cache.get('expiring')).toBe('value');
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should be expired
      expect(await cache.get('expiring')).toBeNull();
    });

    it('should handle exists check for expired keys', async () => {
      await cache.set('expiring', 'value', 1);
      
      expect(await cache.exists('expiring')).toBe(true);
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(await cache.exists('expiring')).toBe(false);
    });
  });

  describe('Pattern Matching', () => {
    it('should find keys matching pattern', async () => {
      await cache.set('user:1', 'data1');
      await cache.set('user:2', 'data2');
      await cache.set('token:1', 'data3');
      
      const userKeys = await cache.keys('*user*');
      
      expect(userKeys.length).toBe(2);
      expect(userKeys.every((k: string) => k.includes('user'))).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should track cache hits and misses', async () => {
      await cache.set('hit-key', 'value');
      
      // Generate hits
      await cache.get('hit-key');
      await cache.get('hit-key');
      
      // Generate misses
      await cache.get('miss-key');
      
      const stats = cache.getStats();
      
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2/3, 2);
    });

    it('should report cache size', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      
      const stats = cache.getStats();
      expect(stats.size).toBe(2);
    });
  });

  describe('Complex Data Types', () => {
    it('should handle arrays', async () => {
      const data = [1, 2, 3, { nested: true }];
      await cache.set('array-key', data);
      
      const result = await cache.get<typeof data>('array-key');
      expect(result).toEqual(data);
    });

    it('should handle nested objects', async () => {
      const data = {
        level1: {
          level2: {
            level3: 'deep value',
          },
        },
      };
      await cache.set('nested-key', data);
      
      const result = await cache.get<typeof data>('nested-key');
      expect(result).toEqual(data);
    });

    it('should handle null values', async () => {
      await cache.set('null-key', null);
      
      const result = await cache.get('null-key');
      expect(result).toBeNull();
    });
  });

  describe('Connection Status', () => {
    it('should always report as connected for memory cache', () => {
      expect(cache.isConnected()).toBe(true);
    });
  });
});
