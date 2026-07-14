import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { MarketplaceOAuthRefreshLock } from '../../application/services/MarketplaceOAuthService';
import { ServiceUnavailableError } from '../../domain/shared/DomainError';

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class RedisMarketplaceOAuthRefreshLock implements MarketplaceOAuthRefreshLock {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'md:oauth-refresh-lock',
    private readonly lockTtlMs = 60_000,
    private readonly acquireTimeoutMs = 35_000,
  ) {}

  async withLock<T>(marketplaceId: string, operation: () => Promise<T>): Promise<T> {
    const key = `${this.prefix}:${marketplaceId}`;
    const token = randomUUID();
    const deadline = Date.now() + this.acquireTimeoutMs;

    while (Date.now() < deadline) {
      const acquired = await this.redis.set(key, token, 'PX', this.lockTtlMs, 'NX');
      if (acquired === 'OK') {
        try {
          return await operation();
        } finally {
          await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new ServiceUnavailableError('Timed out waiting for OLX token refresh lock');
  }
}
