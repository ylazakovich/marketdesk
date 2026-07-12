// Typed key/value cache with TTL over Redis. Values are JSON-serialized. The
// Redis dependency is behind a minimal injectable CacheStore so the cache is
// unit-testable without a live Redis; a default factory wires config/redis.

// Minimal slice of the Redis client the cache needs.
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
}

export interface RedisCacheOptions {
  keyPrefix?: string;
}

export class RedisCache {
  private readonly keyPrefix: string;

  constructor(
    private readonly store: CacheStore,
    options: RedisCacheOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'md:cache:';
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.store.get(this.k(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt/legacy entry — treat as a miss.
      return null;
    }
  }

  // Store a value. When ttlSeconds is provided (and positive) the entry expires;
  // otherwise it is stored without expiry.
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.store.setex(this.k(key), Math.floor(ttlSeconds), serialized);
    } else {
      await this.store.set(this.k(key), serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.store.del(this.k(key));
  }

  private k(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}

// NOTE: the default wiring that binds this cache to the real Redis client
// (config/redis) lives in ../eventBroker/RedisWiring.ts so this module stays
// free of connection/config imports and is trivially unit-testable.
