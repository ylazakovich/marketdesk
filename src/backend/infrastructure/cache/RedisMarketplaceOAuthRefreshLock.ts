import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type {
  MarketplaceOAuthRefreshLease,
  MarketplaceOAuthRefreshLock,
} from '../../application/services/MarketplaceOAuthService';
import { ServiceUnavailableError } from '../../domain/shared/DomainError';

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

interface OAuthLockLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export class RedisMarketplaceOAuthRefreshLock implements MarketplaceOAuthRefreshLock {
  constructor(
    private readonly redis: Redis,
    private readonly logger?: OAuthLockLogger,
    private readonly prefix = 'md:oauth-refresh-lock',
    private readonly lockTtlMs = 60_000,
    private readonly acquireTimeoutMs = 35_000
  ) {}

  async withLock<T>(
    marketplaceId: string,
    operation: (lease: MarketplaceOAuthRefreshLease) => Promise<T>
  ): Promise<T> {
    const key = `${this.prefix}:${marketplaceId}`;
    const token = randomUUID();
    const deadline = Date.now() + this.acquireTimeoutMs;

    while (Date.now() < deadline) {
      const acquired = await this.redis.set(key, token, 'PX', this.lockTtlMs, 'NX');
      if (acquired === 'OK') {
        return this.runWithRenewal(key, token, operation);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new ServiceUnavailableError('Timed out waiting for OLX token refresh lock');
  }

  private async runWithRenewal<T>(
    key: string,
    token: string,
    operation: (lease: MarketplaceOAuthRefreshLease) => Promise<T>
  ): Promise<T> {
    let leaseFailure: unknown;
    let renewalInFlight = false;
    const renew = async (): Promise<void> => {
      if (renewalInFlight || leaseFailure) return;
      renewalInFlight = true;
      try {
        const renewed = await this.redis.eval(RENEW_SCRIPT, 1, key, token, this.lockTtlMs);
        if (renewed !== 1) {
          leaseFailure = new ServiceUnavailableError('Lost OLX token refresh lock ownership');
        }
      } catch (error) {
        leaseFailure = new ServiceUnavailableError('Failed to renew OLX token refresh lock', error);
      } finally {
        renewalInFlight = false;
      }
    };
    const timer = setInterval(() => void renew(), Math.max(1_000, Math.floor(this.lockTtlMs / 3)));
    timer.unref();

    const lease: MarketplaceOAuthRefreshLease = {
      assertOwned: async () => {
        if (leaseFailure) throw leaseFailure;
        const owner = await this.redis.get(key);
        if (owner !== token) {
          throw new ServiceUnavailableError('Lost OLX token refresh lock ownership');
        }
      },
    };

    try {
      return await operation(lease);
    } finally {
      clearInterval(timer);
      try {
        await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
      } catch {
        // Redis/provider errors can carry request context; never attach them to
        // logs on this credential-adjacent path.
        this.logger?.error({}, 'Failed to release OLX token refresh lock');
      }
    }
  }
}
