import { RedisCache, CacheStore } from '../RedisCache';

// In-memory CacheStore that records how values were written.
function memoryStore(): { store: CacheStore; map: Map<string, string>; setexTtls: number[] } {
  const map = new Map<string, string>();
  const setexTtls: number[] = [];
  const store: CacheStore = {
    get: async (key) => (map.has(key) ? (map.get(key) as string) : null),
    set: async (key, value) => {
      map.set(key, value);
      return 'OK';
    },
    setex: async (key, ttl, value) => {
      setexTtls.push(ttl);
      map.set(key, value);
      return 'OK';
    },
    del: async (key) => (map.delete(key) ? 1 : 0),
  };
  return { store, map, setexTtls };
}

describe('RedisCache', () => {
  it('round-trips a typed value with the configured key prefix', async () => {
    const { store, map } = memoryStore();
    const cache = new RedisCache(store, { keyPrefix: 'p:' });

    await cache.set('user', { id: 1, name: 'Ada' });
    const value = await cache.get<{ id: number; name: string }>('user');

    expect(value).toEqual({ id: 1, name: 'Ada' });
    expect(map.has('p:user')).toBe(true);
  });

  it('uses SETEX when a positive TTL is supplied', async () => {
    const { store, setexTtls } = memoryStore();
    const cache = new RedisCache(store);
    await cache.set('k', 123, 60);
    expect(setexTtls).toEqual([60]);
  });

  it('returns null on a miss', async () => {
    const { store } = memoryStore();
    const cache = new RedisCache(store);
    await expect(cache.get('absent')).resolves.toBeNull();
  });

  it('returns null (treats as miss) on corrupt JSON', async () => {
    const { store, map } = memoryStore();
    const cache = new RedisCache(store, { keyPrefix: '' });
    map.set('bad', '{not-json');
    await expect(cache.get('bad')).resolves.toBeNull();
  });

  it('deletes a key', async () => {
    const { store, map } = memoryStore();
    const cache = new RedisCache(store, { keyPrefix: '' });
    await cache.set('gone', 1);
    await cache.del('gone');
    expect(map.has('gone')).toBe(false);
  });
});
