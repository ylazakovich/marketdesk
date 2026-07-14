import { Marketplace } from '../../domain/entities/Marketplace';
import { InMemoryMarketplaceRepository, unwrap } from '../../domain/testkit/support';
import {
  MarketplaceOAuthService,
  type MarketplaceAccountRecord,
  type MarketplaceOAuthServiceDeps,
  type OlxOAuthTokens,
} from '../services/MarketplaceOAuthService';

class InMemoryAccountRepository {
  readonly accounts = new Map<string, MarketplaceAccountRecord>();

  async findByMarketplaceId(marketplaceId: string): Promise<MarketplaceAccountRecord | null> {
    return this.accounts.get(marketplaceId) ?? null;
  }

  async upsert(input: Omit<MarketplaceAccountRecord, 'createdAt' | 'updatedAt'>) {
    const current = this.accounts.get(input.marketplaceId);
    const now = new Date('2026-07-14T12:00:00.000Z');
    const account: MarketplaceAccountRecord = {
      ...input,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.accounts.set(input.marketplaceId, account);
    return account;
  }
}

class InMemoryStateStore {
  readonly values = new Map<
    string,
    Parameters<MarketplaceOAuthServiceDeps['stateStore']['save']>[1]
  >();

  async save(
    state: string,
    context: Parameters<MarketplaceOAuthServiceDeps['stateStore']['save']>[1]
  ) {
    this.values.set(state, context);
  }

  async consume(state: string) {
    const value = this.values.get(state) ?? null;
    this.values.delete(state);
    return value;
  }
}

const initialTokens: OlxOAuthTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenType: 'Bearer',
  scopes: ['basic', 'write'],
  expiresAt: new Date('2026-07-14T13:00:00.000Z'),
};

function setup(refreshLock?: MarketplaceOAuthServiceDeps['refreshLock']) {
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const marketplace = unwrap(
    Marketplace.create({
      id: 'marketplace-olx',
      workspaceId: 'ws-1',
      key: 'olx',
      name: 'OLX',
      connected: false,
    })
  );
  marketplaceRepo.items.set(marketplace.id, marketplace);

  const accountRepo = new InMemoryAccountRepository();
  const stateStore = new InMemoryStateStore();
  const exchangeAuthorizationCode = jest.fn(async () => initialTokens);
  const refreshAccessToken = jest.fn(async () => ({
    ...initialTokens,
    accessToken: 'refreshed-access-token',
    refreshToken: 'rotated-refresh-token',
    expiresAt: new Date('2026-07-14T14:00:00.000Z'),
  }));
  const oauthClient = {
    buildAuthorizationUrl: jest.fn(
      (state: string) => `https://www.olx.pl/oauth/authorize?state=${state}`
    ),
    exchangeAuthorizationCode,
    refreshAccessToken,
  };
  const vault = {
    encrypt: jest.fn((tokens: OlxOAuthTokens) => ({ payload: tokens })),
    decrypt: jest.fn((envelope: Record<string, unknown>) => envelope.payload as OlxOAuthTokens),
  };
  let nonce = 0;
  const service = new MarketplaceOAuthService({
    marketplaceRepo,
    accountRepo,
    stateStore,
    oauthClient,
    credentialVault: vault,
    refreshLock,
    idGenerator: () => `account-${++nonce}`,
    stateGenerator: () => 'oauth-state',
    now: () => new Date('2026-07-14T12:00:00.000Z'),
    stateTtlSeconds: 600,
  });

  return {
    service,
    marketplaceRepo,
    marketplace,
    accountRepo,
    stateStore,
    oauthClient,
    exchangeAuthorizationCode,
    refreshAccessToken,
  };
}

describe('MarketplaceOAuthService', () => {
  it('starts OLX OAuth without marking the marketplace connected', async () => {
    const { service, marketplace, stateStore } = setup();

    const result = await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

    expect(result.authorizationUrl).toContain('https://www.olx.pl/oauth/authorize');
    expect(result.state).toBe('oauth-state');
    expect(stateStore.values.get('oauth-state')).toMatchObject({
      marketplaceId: marketplace.id,
      workspaceId: 'ws-1',
      providerKey: 'olx',
    });
    expect(marketplace.isConnected()).toBe(false);
  });

  it('consumes state once, persists encrypted tokens, then marks OLX connected', async () => {
    const { service, marketplace, marketplaceRepo, accountRepo } = setup();
    await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

    const completed = await service.complete({
      providerKey: 'olx',
      code: 'authorization-code',
      state: 'oauth-state',
    });

    expect(completed.connected).toBe(true);
    expect(completed.account.status).toBe('connected');
    expect(completed.account.scopes).toEqual(['basic', 'write']);
    expect(accountRepo.accounts.get(marketplace.id)?.credentials).toEqual({
      payload: initialTokens,
    });
    expect((await marketplaceRepo.findById(marketplace.id))?.isConnected()).toBe(true);
    await expect(
      service.complete({ providerKey: 'olx', code: 'again', state: 'oauth-state' })
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('reports app-authoritative connection state without exposing credentials', async () => {
    const { service, marketplace } = setup();
    await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });
    await service.complete({
      providerKey: 'olx',
      code: 'authorization-code',
      state: 'oauth-state',
    });

    const status = await service.check({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

    expect(status).toMatchObject({
      connected: true,
      marketplaceId: marketplace.id,
      providerKey: 'olx',
      account: { handle: 'OLX account', status: 'connected' },
      tokenExpiresAt: '2026-07-14T13:00:00.000Z',
    });
    expect(JSON.stringify(status)).not.toContain('access-token');
    expect(JSON.stringify(status)).not.toContain('refresh-token');
  });

  it('refreshes an expired access token and persists refresh-token rotation', async () => {
    const { service, marketplace, accountRepo, refreshAccessToken } = setup();
    await accountRepo.upsert({
      id: 'account-1',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: {
        payload: {
          ...initialTokens,
          expiresAt: new Date('2026-07-14T11:59:00.000Z'),
        },
      },
      status: 'connected',
      scopes: ['basic'],
    });

    const accessToken = await service.getValidAccessToken(marketplace.id);

    expect(accessToken).toBe('refreshed-access-token');
    expect(refreshAccessToken).toHaveBeenCalledWith('refresh-token');
    const saved = accountRepo.accounts.get(marketplace.id)!;
    const savedTokens = saved.credentials.payload as OlxOAuthTokens;
    expect(savedTokens.refreshToken).toBe('rotated-refresh-token');
  });

  it('clears stored credentials when disconnecting', async () => {
    const { service, marketplace, accountRepo } = setup();
    await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });
    await service.complete({ providerKey: 'olx', code: 'code', state: 'oauth-state' });

    await service.disconnect({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

    expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
      status: 'disconnected',
      credentials: {},
    });
    const status = await service.check({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });
    expect(status.connected).toBe(false);
    expect(status.account?.status).toBe('disconnected');
  });

  it('re-reads credentials while holding the refresh lock', async () => {
    let accountRepo: InMemoryAccountRepository;
    const withLock = jest.fn(async (_marketplaceId: string, operation: () => Promise<string>) => {
      const current = accountRepo.accounts.get('marketplace-olx')!;
      await accountRepo.upsert({
        ...current,
        credentials: {
          payload: {
            ...initialTokens,
            accessToken: 'already-refreshed-token',
            expiresAt: new Date('2026-07-14T14:00:00.000Z'),
          },
        },
      });
      return operation();
    });
    const setupResult = setup({ withLock });
    accountRepo = setupResult.accountRepo;
    await accountRepo.upsert({
      id: 'account-1',
      marketplaceId: setupResult.marketplace.id,
      handle: 'OLX account',
      credentials: {
        payload: { ...initialTokens, expiresAt: new Date('2026-07-14T11:59:00.000Z') },
      },
      status: 'connected',
      scopes: ['basic'],
    });

    await expect(setupResult.service.getValidAccessToken(setupResult.marketplace.id)).resolves.toBe(
      'already-refreshed-token'
    );
    expect(withLock).toHaveBeenCalledWith(setupResult.marketplace.id, expect.any(Function));
    expect(setupResult.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('serializes disconnect behind an in-flight refresh so credentials stay cleared', async () => {
    let tail = Promise.resolve();
    const refreshLock: NonNullable<MarketplaceOAuthServiceDeps['refreshLock']> = {
      withLock: async (_marketplaceId, operation) => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await operation({ assertOwned: async () => {} });
        } finally {
          release();
        }
      },
    };
    const { service, marketplace, accountRepo, refreshAccessToken } = setup(refreshLock);
    marketplace.connect();
    await accountRepo.upsert({
      id: 'account-race',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: {
        payload: { ...initialTokens, expiresAt: new Date('2026-07-14T11:59:00.000Z') },
      },
      status: 'connected',
      scopes: ['basic'],
    });
    let finishRefresh!: (tokens: OlxOAuthTokens) => void;
    const refreshStarted = new Promise<void>((resolveStarted) => {
      refreshAccessToken.mockImplementationOnce(
        () =>
          new Promise<OlxOAuthTokens>((resolveRefresh) => {
            finishRefresh = resolveRefresh;
            resolveStarted();
          })
      );
    });

    const refreshing = service.getValidAccessToken(marketplace.id);
    await refreshStarted;
    const disconnecting = service.disconnect({
      marketplaceId: marketplace.id,
      workspaceId: 'ws-1',
    });
    finishRefresh({
      ...initialTokens,
      accessToken: 'refreshed-access-token',
      expiresAt: new Date('2026-07-14T14:00:00.000Z'),
    });

    await refreshing;
    await disconnecting;
    expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
      status: 'disconnected',
      credentials: {},
    });
    expect(marketplace.isConnected()).toBe(false);
  });
});
