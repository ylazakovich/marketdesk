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
      'NX'
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      1,
      'md:oauth-refresh-lock:marketplace-1',
      expect.any(String)
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
      })
    ).rejects.toThrow('refresh failed');
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('renews the owned lease before it expires', async () => {
    jest.useFakeTimers();
    let token = '';
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const redis = {
      set: jest.fn(async (_key: string, value: string) => {
        token = value;
        return 'OK';
      }),
      get: jest.fn(async () => token),
      eval: jest.fn(async () => 1),
    } as unknown as Redis;
    const lock = new RedisMarketplaceOAuthRefreshLock(redis, undefined, 'lock', 3_000, 100);

    const result = lock.withLock('marketplace-1', async (lease) => {
      await gate;
      await lease.assertOwned();
      return 'token';
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('PEXPIRE'"),
      1,
      'lock:marketplace-1',
      expect.any(String),
      3_000
    );
    finish();
    await expect(result).resolves.toBe('token');
    jest.useRealTimers();
  });

  it('does not let an unlock error replace a successful operation result', async () => {
    const logger = { error: jest.fn() };
    const redis = {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => {
        throw new Error('redis unavailable');
      }),
    } as unknown as Redis;
    const lock = new RedisMarketplaceOAuthRefreshLock(redis, logger);

    await expect(lock.withLock('marketplace-1', async () => 'token')).resolves.toBe('token');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Failed to release OLX token refresh lock'
    );
  });
});
