import type { Redis } from 'ioredis';
import { RedisMarketplaceOAuthRefreshLock } from '../RedisMarketplaceOAuthRefreshLock';

describe('RedisMarketplaceOAuthRefreshLock', () => {
  it('acquires and releases the per-marketplace lock', async () => {
    const redis = {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    } as unknown as Redis;
    const lock = new RedisMarketplaceOAuthRefreshLock(redis);

    await expect(lock.withLock('marketplace-1', async () => 'token')).resolves.toBe('token');

    expect(redis.set).toHaveBeenCalledWith(
      'md:oauth-refresh-lock:marketplace-1',
      expect.any(String),
      'PX',
      60_000,
      'NX',
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      1,
      'md:oauth-refresh-lock:marketplace-1',
      expect.any(String),
    );
  });

  it('releases the lock when the protected operation fails', async () => {
    const redis = {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    } as unknown as Redis;
    const lock = new RedisMarketplaceOAuthRefreshLock(redis);

    await expect(
      lock.withLock('marketplace-1', async () => {
        throw new Error('refresh failed');
      }),
    ).rejects.toThrow('refresh failed');
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });
});
