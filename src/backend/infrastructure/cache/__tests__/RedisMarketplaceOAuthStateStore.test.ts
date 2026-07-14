import type { Redis } from 'ioredis';
import { RedisMarketplaceOAuthStateStore } from '../RedisMarketplaceOAuthStateStore';

class FakeRedis {
  values = new Map<string, string>();
  savedKey = '';

  async set(key: string, value: string): Promise<'OK'> {
    this.savedKey = key;
    this.values.set(key, value);
    return 'OK';
  }

  async eval(_script: string, _keys: number, key: string): Promise<string | null> {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
}

describe('RedisMarketplaceOAuthStateStore', () => {
  it('stores a hash of state and consumes the context exactly once', async () => {
    const redis = new FakeRedis();
    const store = new RedisMarketplaceOAuthStateStore(
      redis as unknown as Redis,
      'test:oauth',
      () => new Date('2026-07-14T12:00:00.000Z'),
    );
    const context = {
      providerKey: 'olx' as const,
      marketplaceId: 'marketplace-1',
      workspaceId: 'workspace-1',
      expiresAt: new Date('2026-07-14T12:10:00.000Z'),
    };

    await store.save('raw-oauth-state', context);

    expect(redis.savedKey).not.toContain('raw-oauth-state');
    await expect(store.consume('raw-oauth-state')).resolves.toEqual(context);
    await expect(store.consume('raw-oauth-state')).resolves.toBeNull();
  });
});
