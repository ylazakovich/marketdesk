import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type {
  MarketplaceOAuthStateContext,
  MarketplaceOAuthStateStore,
} from '../../application/services/MarketplaceOAuthService';

const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value
`;

export class RedisMarketplaceOAuthStateStore implements MarketplaceOAuthStateStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'md:oauth-state',
    private readonly now: () => Date = () => new Date(),
  ) {}

  async save(state: string, context: MarketplaceOAuthStateContext): Promise<void> {
    const ttlSeconds = Math.max(
      1,
      Math.ceil((context.expiresAt.getTime() - this.now().getTime()) / 1000),
    );
    await this.redis.set(
      this.key(state),
      JSON.stringify({ ...context, expiresAt: context.expiresAt.toISOString() }),
      'EX',
      ttlSeconds,
    );
  }

  async consume(state: string): Promise<MarketplaceOAuthStateContext | null> {
    const serialized = (await this.redis.eval(
      CONSUME_SCRIPT,
      1,
      this.key(state),
    )) as string | null;
    if (!serialized) return null;
    const decoded = JSON.parse(serialized) as Omit<MarketplaceOAuthStateContext, 'expiresAt'> & {
      expiresAt: string;
    };
    return { ...decoded, expiresAt: new Date(decoded.expiresAt) };
  }

  private key(state: string): string {
    const digest = createHash('sha256').update(state).digest('hex');
    return `${this.prefix}:${digest}`;
  }
}
