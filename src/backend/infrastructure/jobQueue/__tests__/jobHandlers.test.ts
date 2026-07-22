import {
  SyncMarketplaceHandler,
  MarketplaceAdapterResolver,
} from '../JobHandlers/SyncMarketplaceHandler';
import {
  PublishListingHandler,
  ListingFinalizationError,
  type PublishAttemptCheckpoint,
  type PublishAttemptStore,
} from '../JobHandlers/PublishListingHandler';
import { HermesRunHandler, HermesEngine } from '../JobHandlers/HermesRunHandler';
import type {
  IMarketplaceAdapter,
  PublishResult,
  SyncedListing,
} from '../../../domain/services/MarketplaceAdapter';
import type { DomainEvent, IEventPublisher } from '../../../domain/ports/IEventPublisher';
import type { MarketplaceKey } from '../../../../shared/types';
import { Listing } from '../../../domain/entities/Listing';
import { Marketplace } from '../../../domain/entities/Marketplace';
import { Ok, Err } from '../../../domain/shared/Result';
import {
  NotFoundError,
  ServiceUnavailableError,
  InvalidStateError,
  ReconciliationRequiredError,
} from '../../../domain/shared/DomainError';
import type { MarketplaceHttpClient } from '../../adapters/MarketplaceHttpClient';
import { unwrap, money } from '../../../domain/testkit/support';

function fakeAdapter(overrides: Partial<IMarketplaceAdapter> = {}): IMarketplaceAdapter {
  return {
    getKey: () => 'olx',
    publish: jest.fn(),
    updateListing: jest.fn(),
    delist: jest.fn(),
    sync: jest.fn(),
    fetchListing: jest.fn(),
    ...overrides,
  } as IMarketplaceAdapter;
}

function resolverFor(adapter: IMarketplaceAdapter): {
  resolver: MarketplaceAdapterResolver;
  create: jest.Mock;
} {
  const create = jest.fn((_key: MarketplaceKey) => adapter);
  return { resolver: { create }, create };
}

function memoryPublishAttempts(): PublishAttemptStore {
  const attempts = new Map<string, PublishAttemptCheckpoint>();
  const listingGenerations = new Map<string, string>();
  return {
    find: async (operationId) => attempts.get(operationId) ?? null,
    begin: async (
      operationId: string,
      listingId: string,
      marketplaceKey: MarketplaceKey,
      listingUpdatedAt: Date
    ) => {
      const abandoned = attempts.get(operationId);
      const activeOther = [...attempts.values()].some((attempt) =>
        attempt.operationId !== operationId
        && attempt.listingId === listingId
        && (attempt.status === 'publishing' || attempt.status === 'published'));
      if (abandoned
        && abandoned.status === 'abandoned'
        && abandoned.listingId === listingId
        && abandoned.listingUpdatedAt.getTime() === listingUpdatedAt.getTime()
        && !activeOther) {
        const reclaimed = { ...abandoned, status: 'publishing' as const };
        attempts.set(operationId, reclaimed);
        return { created: true, checkpoint: reclaimed };
      }
      const latest = [...attempts.values()]
        .filter((attempt) => attempt.listingId === listingId)
        .sort((a, b) => b.listingUpdatedAt.getTime() - a.listingUpdatedAt.getTime())[0];
      if (latest && latest.listingUpdatedAt.getTime() >= listingUpdatedAt.getTime()) {
        return { created: false, checkpoint: latest };
      }
      const existing = attempts.get(operationId);
      if (existing) return { created: false, checkpoint: existing };
      const generationOperationId = listingGenerations.get(
        `${listingId}:${listingUpdatedAt.toISOString()}`
      );
      if (generationOperationId) {
        return { created: false, checkpoint: attempts.get(generationOperationId)! };
      }
      const active = [...attempts.values()].find(
        (attempt) =>
          attempt.listingId === listingId &&
          (attempt.status === 'publishing' || attempt.status === 'published')
      );
      if (active) return { created: false, checkpoint: active };
      const checkpoint: PublishAttemptCheckpoint = {
        operationId,
        listingId,
        listingUpdatedAt,
        marketplaceKey,
        status: 'publishing',
        externalListingId: null,
        externalUrl: null,
        publishedAt: null,
        remoteStatus: null,
        remoteImageUrls: [],
      };
      attempts.set(operationId, checkpoint);
      listingGenerations.set(`${listingId}:${listingUpdatedAt.toISOString()}`, operationId);
      return { created: true, checkpoint };
    },
    markPublished: async (operationId, result) => {
      const existing = attempts.get(operationId)!;
      attempts.set(operationId, {
        ...existing,
        status: 'published',
        externalListingId: result.externalListingId,
        externalUrl: result.externalUrl ?? null,
        publishedAt: result.publishedAt,
        remoteStatus: result.remoteStatus ?? null,
        remoteImageUrls: result.remoteImageUrls ?? [],
      });
    },
    markFinalized: async (operationId) => {
      const existing = attempts.get(operationId)!;
      attempts.set(operationId, { ...existing, status: 'finalized' });
    },
    markAbandoned: async (operationId) => {
      const existing = attempts.get(operationId)!;
      attempts.set(operationId, { ...existing, status: 'abandoned' });
    },
  };
}

function makePublishHandler(...args: ConstructorParameters<typeof PublishListingHandler>) {
  const [adapters, events, listings, accessTokens, authenticatedHttpClient, attempts, quota] = args;
  return new PublishListingHandler(
    adapters,
    events,
    listings,
    accessTokens,
    authenticatedHttpClient,
    attempts ?? memoryPublishAttempts(),
    quota ?? {
      consumeReservation: async () => ({
        applicable: true,
        marketplaceKey: 'olx' as const,
        status: 'available' as const,
        decision: 'allow' as const,
        reason: 'free_unit_available',
        requiresOverride: false,
        consumedUnit: true,
      }),
    },
  );
}

describe('SyncMarketplaceHandler', () => {
  it('resolves the adapter by key and returns its sync results', async () => {
    const synced: SyncedListing[] = [
      { externalListingId: 'olx-1', status: 'live', views: 5, watchers: 1, messages: 0 },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver, create } = resolverFor(adapter);
    const handler = new SyncMarketplaceHandler(resolver);

    const result = await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['olx-1'],
    });

    expect(create).toHaveBeenCalledWith('olx');
    expect(adapter.sync).toHaveBeenCalledWith(['olx-1']);
    // No persistence stores injected -> nothing persisted.
    expect(result).toMatchObject({
      marketplaceKey: 'olx',
      synced,
      persisted: 0,
      marketplaceUpdated: false,
    });
  });

  it('uses the marketplace account access token for OLX sync jobs', async () => {
    const synced: SyncedListing[] = [
      { externalListingId: 'olx-1', status: 'live', views: 5, watchers: 1, messages: 0 },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const create = jest.fn(() => adapter);
    const tokenProvider = {
      getValidAccessTokenContext: jest.fn(async () => ({
        accessToken: 'workspace-access-token',
        account: { id: 'account-1', revision: 7 },
      })),
    };
    const authenticatedClient: MarketplaceHttpClient = { request: jest.fn() };
    const clientFactory = jest.fn(() => authenticatedClient);
    const handler = new SyncMarketplaceHandler(
      { create },
      { accessTokens: tokenProvider, authenticatedHttpClient: clientFactory }
    );

    await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['olx-1'],
    });

    expect(tokenProvider.getValidAccessTokenContext).toHaveBeenCalledWith('m-1');
    expect(clientFactory).toHaveBeenCalledWith('workspace-access-token');
    expect(create).toHaveBeenCalledWith('olx', authenticatedClient);
    expect(adapter.sync).toHaveBeenCalledWith(['olx-1']);
  });

  it('keeps non-OLX sync on the existing generic adapter path', async () => {
    const adapter = fakeAdapter({ sync: jest.fn(async () => []) });
    const create = jest.fn(() => adapter);
    const tokenProvider = {
      getValidAccessTokenContext: jest.fn(async () => ({
        accessToken: 'unused-token',
        account: { id: 'account-unused', revision: 1 },
      })),
    };
    const clientFactory = jest.fn(() => ({ request: jest.fn() }));
    const handler = new SyncMarketplaceHandler(
      { create },
      { accessTokens: tokenProvider, authenticatedHttpClient: clientFactory }
    );

    await handler.handle({
      marketplaceKey: 'allegro',
      marketplaceId: 'm-2',
      externalListingIds: ['allegro-1'],
    });

    expect(tokenProvider.getValidAccessTokenContext).not.toHaveBeenCalled();
    expect(clientFactory).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('allegro');
  });

  it('records marketplace error when OLX credentials are unavailable', async () => {
    const create = jest.fn(() => fakeAdapter());
    const tokenProvider = {
      getValidAccessTokenContext: jest.fn(async () => {
        throw new InvalidStateError('OLX account is not connected');
      }),
    };
    const marketplace = unwrap(
      Marketplace.create({ id: 'm-1', workspaceId: 'w-1', key: 'olx', name: 'OLX' })
    );
    const marketplaceStore = {
      findById: jest.fn(async () => marketplace),
      save: jest.fn(async () => undefined),
    };
    const handler = new SyncMarketplaceHandler(
      { create },
      {
        marketplaceStore,
        accessTokens: tokenProvider,
        authenticatedHttpClient: () => ({ request: jest.fn() }),
      }
    );

    await expect(
      handler.handle({ marketplaceKey: 'olx', marketplaceId: 'm-1', externalListingIds: [] })
    ).rejects.toThrow('OLX account is not connected');
    expect(create).not.toHaveBeenCalled();
    expect(marketplace.errorCount).toBe(1);
    expect(marketplaceStore.save).toHaveBeenCalled();
  });

  it('persists fetched stats onto listings and records the marketplace sync (C5)', async () => {
    const synced: SyncedListing[] = [
      {
        externalListingId: 'ext-1',
        externalUrl: 'https://www.olx.pl/d/oferta/ext-1',
        status: 'live',
        views: 42,
        watchers: 3,
        messages: 2,
        marketplaceCategory: {
          providerCategoryId: '2000',
          name: 'Projectors',
          path: ['Electronics', 'TV and video', 'Projectors'],
          source: 'provider_taxonomy',
          confidence: 1,
          isLeaf: true,
          taxonomyVerifiedAt: '2026-07-16T12:00:00.000Z',
          taxonomyStaleAt: '2026-07-17T12:00:00.000Z',
        },
      },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);

    const listing = unwrap(
      Listing.create({
        id: 'l-1',
        productId: 'p-1',
        marketplaceId: 'm-1',
        price: money(50),
        status: 'live',
        marketplaceListingId: 'ext-1',
        publishedAt: new Date(),
      })
    );
    const saved: Listing[] = [];
    const listingStore = {
      findByMarketplace: jest.fn(async () => [listing]),
      saveAll: jest.fn(async (ls: Listing[]) => {
        saved.push(...ls);
      }),
    };

    const marketplace = unwrap(
      Marketplace.create({ id: 'm-1', workspaceId: 'w-1', key: 'olx', name: 'OLX' })
    );
    marketplace.recordSyncError(); // errorCount = 1 so success reset is observable
    const marketplaceStore = {
      findById: jest.fn(async () => marketplace),
      save: jest.fn(async () => undefined),
    };

    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore,
      marketplaceStore,
    });

    const result = await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['ext-1'],
    });

    expect(result.persisted).toBe(1);
    expect(result.marketplaceUpdated).toBe(true);
    expect(saved[0].views).toBe(42);
    expect(saved[0].watchers).toBe(3);
    expect(saved[0].externalUrl).toBe('https://www.olx.pl/d/oferta/ext-1');
    expect(saved[0].marketplaceCategory).toEqual(synced[0].marketplaceCategory);
    expect(saved[0].lastSyncAt).not.toBeNull();
    expect(marketplaceStore.save).toHaveBeenCalled();
    expect(marketplace.errorCount).toBe(0); // reset on success
    expect(marketplace.lastSyncAt).not.toBeNull();
  });

  it('persists listing evidence and product reconciliation through one atomic callback', async () => {
    const synced: SyncedListing[] = [{
      externalListingId: 'ext-atomic',
      status: 'live',
      marketplaceCategory: {
        providerCategoryId: '2000', name: 'Projectors',
        path: ['Electronics', 'TV and video', 'Projectors'],
        source: 'provider_taxonomy', confidence: 1, isLeaf: true,
        taxonomyVerifiedAt: '2026-07-16T12:00:00.000Z',
        taxonomyStaleAt: '2026-07-17T12:00:00.000Z',
      },
    }];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const listing = unwrap(Listing.create({
      id: 'l-atomic', productId: 'p-atomic', marketplaceId: 'm-1',
      price: money(50), status: 'live', marketplaceListingId: 'ext-atomic',
    }));
    const expectedUpdatedAt = listing.updatedAt;
    const marketplace = unwrap(Marketplace.create({
      id: 'm-1', workspaceId: 'w-1', key: 'olx', name: 'OLX',
    }));
    const listingStore = {
      findByMarketplace: jest.fn(async () => [listing]),
      saveAll: jest.fn(async () => undefined),
    };
    const persistAndReconcileProductCategories = jest.fn(async () => undefined);
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore,
      marketplaceStore: {
        findById: jest.fn(async () => marketplace),
        save: jest.fn(async () => undefined),
      },
      persistAndReconcileProductCategories,
    });

    await handler.handle({
      marketplaceKey: 'olx', marketplaceId: 'm-1', externalListingIds: ['ext-atomic'],
      trigger: 'manual', actorId: 'user-1',
    });

    expect(listingStore.saveAll).not.toHaveBeenCalled();
    expect(persistAndReconcileProductCategories).toHaveBeenCalledWith(expect.objectContaining({
      marketplace,
      listings: [expect.objectContaining({ id: 'l-atomic' })],
      expectedUpdatedAt: new Map([['l-atomic', expectedUpdatedAt]]),
      mismatchCandidates: [expect.objectContaining({ listing: expect.objectContaining({ id: 'l-atomic' }) })],
      job: expect.objectContaining({ trigger: 'manual', actorId: 'user-1' }),
    }));
    expect(listing.marketplaceCategory).toEqual(synced[0].marketplaceCategory);
  });

  it('does not publish status or recommendation side effects when atomic persistence rejects', async () => {
    const oldCategory = {
      providerCategoryId: '1000', name: 'Televisions', path: ['Electronics', 'Televisions'],
      source: 'provider_taxonomy' as const, confidence: 1, isLeaf: true,
      taxonomyVerifiedAt: '2026-07-16T11:00:00.000Z', taxonomyStaleAt: '2026-07-17T11:00:00.000Z',
    };
    const newCategory = {
      ...oldCategory, providerCategoryId: '2000', name: 'Projectors',
      path: ['Electronics', 'Projectors'],
    };
    const sync = jest.fn(async (): Promise<SyncedListing[]> => [{
      externalListingId: 'ext-cas', status: 'expired', remoteStatus: 'removed',
      marketplaceCategory: newCategory,
    }]);
    const adapter = fakeAdapter({ sync });
    const { resolver } = resolverFor(adapter);
    const listing = unwrap(Listing.create({
      id: 'l-cas', productId: 'p-cas', marketplaceId: 'm-1', price: money(50),
      status: 'live', marketplaceListingId: 'ext-cas', marketplaceCategory: oldCategory,
    }));
    const marketplace = unwrap(Marketplace.create({
      id: 'm-1', workspaceId: 'w-1', key: 'olx', name: 'OLX',
    }));
    const publish = jest.fn(async () => undefined);
    const recommend = jest.fn(async () => undefined);
    const persist = jest.fn(async () => {
      throw new Error('Listing changed concurrently; retry sync');
    });
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore: {
        findByMarketplace: jest.fn(async () => [listing]),
        saveAll: jest.fn(async () => undefined),
      },
      marketplaceStore: {
        findById: jest.fn(async () => marketplace),
        save: jest.fn(async () => undefined),
      },
      eventPublisher: { publish },
      recommendCategoryMismatch: recommend,
      persistAndReconcileProductCategories: persist,
    });

    await expect(handler.handle({
      marketplaceKey: 'olx', marketplaceId: 'm-1', externalListingIds: ['ext-cas'],
    })).rejects.toThrow('Listing changed concurrently');

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      mismatchCandidates: [expect.objectContaining({ listing: expect.objectContaining({ id: 'l-cas' }) })],
    }));
    expect(recommend).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('rechecks exact OLX account binding before mismatch recommendation', async () => {
    const projectorCategory = {
      providerCategoryId: '100',
      source: 'provider_taxonomy',
      name: 'Projectors',
      path: ['Electronics', 'Video'],
      confidence: 0.99,
      isLeaf: true,
      taxonomyVerifiedAt: '2026-07-21T00:00:00.000Z',
      taxonomyStaleAt: '2026-07-22T00:00:00.000Z',
    };
    const headphonesCategory = {
      providerCategoryId: '200',
      source: 'provider_taxonomy',
      name: 'Headphones',
      path: ['Electronics', 'Audio'],
      confidence: 0.99,
      isLeaf: true,
      taxonomyVerifiedAt: '2026-07-21T00:00:00.000Z',
      taxonomyStaleAt: '2026-07-22T00:00:00.000Z',
    };
    const synced: SyncedListing[] = [{
      externalListingId: 'ext-stale',
      status: 'live',
      remoteStatus: 'active',
      marketplaceCategory: projectorCategory,
      views: 10,
      watchers: 0,
      messages: 1,
    }];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const marketplace = unwrap(
      Marketplace.create({
        id: 'm-stale',
        workspaceId: 'w-stale',
        key: 'olx',
        name: 'OLX',
      })
    );
    const listing = unwrap(
      Listing.create({
        id: 'l-stale',
        productId: 'p-stale',
        marketplaceId: 'm-stale',
        price: money(50),
        status: 'live',
        marketplaceListingId: 'ext-stale',
        marketplaceCategory: headphonesCategory,
        publishedAt: new Date(),
      })
    );
    const tokenProvider = {
      getValidAccessTokenContext: jest
        .fn()
        .mockResolvedValueOnce({ accessToken: 'fresh-token', account: { id: 'acc-stale', revision: 1 } })
        .mockRejectedValueOnce(new ReconciliationRequiredError('OLX account changed after the operation was reviewed')),
    };
    const recommend = jest.fn(async () => undefined);
    const listingStore = {
      findByMarketplace: jest.fn(async () => [listing]),
      saveAll: jest.fn(async () => undefined),
    };
    const handler = new SyncMarketplaceHandler(
      resolver,
      {
        listingStore,
        marketplaceStore: {
          findById: jest.fn(async () => marketplace),
          save: jest.fn(async () => undefined),
        },
        accessTokens: tokenProvider,
        authenticatedHttpClient: () => ({ request: jest.fn() }),
        recommendCategoryMismatch: recommend,
      },
    );

    await expect(handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-stale',
      externalListingIds: ['ext-stale'],
    })).rejects.toThrow(ReconciliationRequiredError);

    expect(tokenProvider.getValidAccessTokenContext).toHaveBeenCalledTimes(2);
    expect(tokenProvider.getValidAccessTokenContext).toHaveBeenCalledWith('m-stale', { id: 'acc-stale', revision: 1 });
    expect(recommend).not.toHaveBeenCalled();
    expect(listingStore.saveAll).not.toHaveBeenCalled();
  });

  it('fails closed when the job provider key differs from the persisted marketplace', async () => {
    const adapter = fakeAdapter();
    const { resolver } = resolverFor(adapter);
    const marketplace = unwrap(Marketplace.create({
      id: 'm-1', workspaceId: 'w-1', key: 'allegro', name: 'Allegro',
    }));
    const handler = new SyncMarketplaceHandler(resolver, {
      marketplaceStore: {
        findById: jest.fn(async () => marketplace),
        save: jest.fn(async () => undefined),
      },
    });

    await expect(handler.handle({
      marketplaceKey: 'olx', marketplaceId: 'm-1', externalListingIds: [],
    })).rejects.toThrow('does not match persisted marketplace');
    expect(adapter.sync).not.toHaveBeenCalled();
  });

  it('reconciles terminal remote lifecycle statuses and emits one transition event', async () => {
    const synced: SyncedListing[] = [
      {
        externalListingId: 'ext-expired',
        status: 'expired',
        remoteStatus: 'removed',
        views: 9,
        watchers: 1,
        messages: 0,
      },
      {
        externalListingId: 'ext-rejected',
        status: 'error',
        remoteStatus: 'rejected',
        views: 0,
        watchers: 0,
        messages: 0,
      },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const expired = unwrap(
      Listing.create({
        id: 'l-expired',
        productId: 'p-1',
        marketplaceId: 'm-1',
        price: money(50),
        status: 'live',
        marketplaceListingId: 'ext-expired',
        publishedAt: new Date(),
      })
    );
    const rejected = unwrap(
      Listing.create({
        id: 'l-rejected',
        productId: 'p-2',
        marketplaceId: 'm-1',
        price: money(50),
        status: 'live',
        marketplaceListingId: 'ext-rejected',
        publishedAt: new Date(),
      })
    );
    const events: DomainEvent[] = [];
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore: {
        findByMarketplace: jest.fn(async () => [expired, rejected]),
        saveAll: jest.fn(async () => undefined),
      },
      eventPublisher: { publish: jest.fn(async (event) => events.push(event)) },
    });

    await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['ext-expired', 'ext-rejected'],
    });

    expect(expired.status).toBe('expired');
    expect(expired.syncError).toBe('Remote advert is removed');
    expect(rejected.status).toBe('error');
    expect(rejected.syncError).toBe('Remote advert is rejected');
    expect(events.map((event) => event.type)).toEqual([
      'listing.remote_status_reconciled',
      'listing.remote_status_reconciled',
    ]);
  });

  it('observes transient and unknown remote statuses without destructive transitions', async () => {
    const synced: SyncedListing[] = [
      {
        externalListingId: 'ext-pending',
        status: 'live',
        remoteStatus: 'pending',
        views: 1,
        watchers: 0,
        messages: 0,
      },
      {
        externalListingId: 'ext-mystery',
        status: 'draft',
        remoteStatus: 'surprise_state',
        views: 2,
        watchers: 0,
        messages: 0,
      },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const pending = unwrap(
      Listing.create({
        id: 'l-pending',
        productId: 'p-1',
        marketplaceId: 'm-1',
        price: money(50),
        status: 'live',
        marketplaceListingId: 'ext-pending',
        publishedAt: new Date(),
      })
    );
    const unknown = unwrap(
      Listing.create({
        id: 'l-unknown',
        productId: 'p-2',
        marketplaceId: 'm-1',
        price: money(50),
        status: 'live',
        marketplaceListingId: 'ext-mystery',
        publishedAt: new Date(),
      })
    );
    const publish = jest.fn(async () => undefined);
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore: {
        findByMarketplace: jest.fn(async () => [pending, unknown]),
        saveAll: jest.fn(async () => undefined),
      },
      eventPublisher: { publish },
    });

    await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['ext-pending', 'ext-mystery'],
    });

    expect(pending.status).toBe('live');
    expect(pending.syncError).toBe('Remote status observed: pending');
    expect(unknown.status).toBe('live');
    expect(unknown.syncError).toBe('Unknown remote status observed: surprise_state');
    expect(publish).not.toHaveBeenCalled();
  });

  it('treats repeated reconciled statuses as idempotent', async () => {
    const synced: SyncedListing[] = [
      {
        externalListingId: 'ext-expired',
        status: 'expired',
        remoteStatus: 'expired',
        views: 9,
        watchers: 1,
        messages: 0,
      },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const listing = unwrap(
      Listing.create({
        id: 'l-expired',
        productId: 'p-1',
        marketplaceId: 'm-1',
        price: money(50),
        status: 'expired',
        marketplaceListingId: 'ext-expired',
        publishedAt: new Date(),
      })
    );
    const publish = jest.fn(async () => undefined);
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore: {
        findByMarketplace: jest.fn(async () => [listing]),
        saveAll: jest.fn(async () => undefined),
      },
      eventPublisher: { publish },
    });

    await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['ext-expired'],
    });

    expect(listing.status).toBe('expired');
    expect(publish).not.toHaveBeenCalled();
  });

  it('resolves current marketplace listing ids when a scheduled sync job has an empty payload', async () => {
    const synced: SyncedListing[] = [
      { externalListingId: 'ext-1', status: 'live', views: 7, watchers: 1, messages: 0 },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const listing = unwrap(
      Listing.create({
        id: 'l-1',
        productId: 'p-1',
        marketplaceId: 'm-1',
        price: money(50),
        status: 'live',
        marketplaceListingId: 'ext-1',
        publishedAt: new Date(),
      })
    );
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore: {
        findByMarketplace: jest.fn(async () => [listing]),
        saveAll: jest.fn(async () => undefined),
      },
    });

    await handler.handle({ marketplaceKey: 'olx', marketplaceId: 'm-1', externalListingIds: [] });

    expect(adapter.sync).toHaveBeenCalledWith(['ext-1']);
  });

  it('preserves existing engagement counters when OLX reports a metric as unavailable', async () => {
    const synced: SyncedListing[] = [
      { externalListingId: 'ext-1', status: 'live', views: null, watchers: 4, messages: null },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const listing = unwrap(
      Listing.create({
        id: 'l-1',
        productId: 'p-1',
        marketplaceId: 'm-1',
        price: money(50),
        status: 'live',
        marketplaceListingId: 'ext-1',
        publishedAt: new Date(),
      })
    );
    listing.recordSyncStats({ views: 10, watchers: 2, messages: 1 });
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore: {
        findByMarketplace: jest.fn(async () => [listing]),
        saveAll: jest.fn(async () => undefined),
      },
    });

    await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['ext-1'],
    });

    expect(listing.views).toBe(10);
    expect(listing.watchers).toBe(4);
    expect(listing.messages).toBe(1);
    expect(listing.lastSyncAt).not.toBeNull();
  });

  it('clears a legacy phone-view-derived message value when OLX exposes no message counter', async () => {
    const synced: SyncedListing[] = [{
      externalListingId: 'ext-1',
      status: 'live',
      remoteStatus: 'active',
      views: 10,
      watchers: 2,
      messages: null,
      messageMetricStatus: 'unavailable',
    }];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const listing = unwrap(Listing.create({
      id: 'l-1',
      productId: 'p-1',
      marketplaceId: 'm-1',
      price: money(50),
      status: 'live',
      marketplaceListingId: 'ext-1',
      publishedAt: new Date(),
    }));
    listing.recordSyncStats({ views: 10, watchers: 2, messages: 0 });
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore: {
        findByMarketplace: jest.fn(async () => [listing]),
        saveAll: jest.fn(async () => undefined),
      },
    });

    await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['ext-1'],
    });

    expect(listing.messages).toBeNull();
    expect(listing.syncError).toBeNull();
  });

  it('marks messages unavailable when the OLX advert is missing', async () => {
    const synced: SyncedListing[] = [{
      externalListingId: 'ext-missing',
      status: 'expired',
      remoteStatus: 'missing',
      missing: true,
      views: 0,
      watchers: 0,
      messages: null,
      messageMetricStatus: 'unavailable',
    }];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const listing = unwrap(Listing.create({
      id: 'l-missing',
      productId: 'p-1',
      marketplaceId: 'm-1',
      price: money(50),
      status: 'live',
      marketplaceListingId: 'ext-missing',
      publishedAt: new Date(),
    }));
    listing.recordSyncStats({ views: 10, watchers: 2, messages: 0 });
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore: {
        findByMarketplace: jest.fn(async () => [listing]),
        saveAll: jest.fn(async () => undefined),
      },
    });

    await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['ext-missing'],
    });

    expect(listing.status).toBe('expired');
    expect(listing.messages).toBeNull();
    expect(listing.syncError).toBe('Remote advert missing during sync');
  });

  it('preserves the last message value and marks it stale on a partial statistics failure', async () => {
    const synced: SyncedListing[] = [{
      externalListingId: 'ext-1',
      status: 'live',
      remoteStatus: 'pending',
      views: 11,
      watchers: 2,
      messageMetricStatus: 'error',
    }];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);
    const listing = unwrap(Listing.create({
      id: 'l-1',
      productId: 'p-1',
      marketplaceId: 'm-1',
      price: money(50),
      status: 'live',
      marketplaceListingId: 'ext-1',
      publishedAt: new Date(),
    }));
    listing.recordSyncStats({ views: 10, watchers: 2, messages: 1 });
    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore: {
        findByMarketplace: jest.fn(async () => [listing]),
        saveAll: jest.fn(async () => undefined),
      },
    });

    await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['ext-1'],
    });

    expect(listing.views).toBe(11);
    expect(listing.messages).toBe(1);
    expect(listing.syncError).toBe(
      'Remote status observed: pending; Message metric is stale: provider statistics request failed',
    );
    expect(listing.lastSyncAt).not.toBeNull();
  });

  it('records a marketplace sync error and rethrows when the adapter fails (C5)', async () => {
    const adapter = fakeAdapter({
      sync: jest.fn(async () => {
        throw new Error('adapter down');
      }),
    });
    const { resolver } = resolverFor(adapter);
    const marketplace = unwrap(
      Marketplace.create({ id: 'm-1', workspaceId: 'w-1', key: 'olx', name: 'OLX' })
    );
    const marketplaceStore = {
      findById: jest.fn(async () => marketplace),
      save: jest.fn(async () => undefined),
    };
    const handler = new SyncMarketplaceHandler(resolver, { marketplaceStore });

    await expect(
      handler.handle({ marketplaceKey: 'olx', marketplaceId: 'm-1', externalListingIds: [] })
    ).rejects.toThrow('adapter down');
    expect(marketplace.errorCount).toBe(1);
    expect(marketplaceStore.save).toHaveBeenCalled();
  });
});

describe('PublishListingHandler', () => {
  const publishResult: PublishResult = {
    externalListingId: 'olx-99',
    externalUrl: 'https://www.olx.pl/d/oferta/olx-99',
    publishedAt: new Date('2026-07-11T00:00:00.000Z'),
  };
  const input = {
    productName: 'Widget',
    description: 'A perfectly adequate widget for testing purposes.',
    price: 49.99,
    currency: 'PLN',
    category: 'electronics',
    condition: 'new',
    imageUrls: [],
  };

  it('publishes via the adapter and emits a listing.published event', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const { resolver } = resolverFor(adapter);
    const published: DomainEvent[] = [];
    const events: IEventPublisher = {
      publish: async (e) => {
        published.push(e);
      },
    };
    const handler = makePublishHandler(resolver, events);

    const result = await handler.handle({
      operationId: 'op-1',
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      listingId: 'l-1',
      input,
    });

    expect(adapter.publish).toHaveBeenCalledWith(input);
    expect(result.result).toEqual(publishResult);
    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('listing.published');
    expect(published[0].aggregateId).toBe('l-1');
    expect(published[0].payload).toMatchObject({
      externalListingId: 'olx-99',
      externalUrl: 'https://www.olx.pl/d/oferta/olx-99',
    });
  });

  it('claims the listing fence before consuming quota and dispatching the provider POST', async () => {
    const publish = jest.fn(async () => publishResult);
    const preparePublish = jest.fn(async () => ({ execute: publish }));
    const adapter = fakeAdapter({ publish, preparePublish });
    const { resolver } = resolverFor(adapter);
    const attempts = memoryPublishAttempts();
    const begin = jest.spyOn(attempts, 'begin');
    const consumeReservation = jest.fn(async () => ({
      applicable: true, marketplaceKey: 'olx' as const, status: 'available' as const,
      decision: 'allow' as const, reason: 'free_unit_available', requiresOverride: false, consumedUnit: true,
    }));
    const handler = makePublishHandler(
      resolver, undefined, undefined, undefined, undefined, attempts, { consumeReservation },
    );

    await handler.handle({
      operationId: 'op-order', marketplaceKey: 'olx', marketplaceId: 'm-1',
      listingId: 'l-order', listingUpdatedAt: '2026-07-16T12:00:00.000Z', input,
    });

    expect(preparePublish.mock.invocationCallOrder[0]).toBeLessThan(begin.mock.invocationCallOrder[0]);
    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(consumeReservation.mock.invocationCallOrder[0]);
    expect(consumeReservation.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0]);
  });

  it('does not claim a fence or consume quota when local transport policy rejects preflight', async () => {
    const preparePublish = jest.fn(async () => {
      throw new Error('Live marketplace publish is disabled');
    });
    const adapter = fakeAdapter({ preparePublish });
    const { resolver } = resolverFor(adapter);
    const attempts = memoryPublishAttempts();
    const begin = jest.spyOn(attempts, 'begin');
    const consumeReservation = jest.fn();
    const handler = makePublishHandler(
      resolver, undefined, undefined, undefined, undefined, attempts, { consumeReservation },
    );

    await expect(handler.handle({
      operationId: 'op-local-gate', marketplaceKey: 'olx', marketplaceId: 'm-1',
      listingId: 'l-local-gate', listingUpdatedAt: '2026-07-16T12:00:00.000Z', input,
    })).rejects.toThrow('Live marketplace publish is disabled');

    expect(begin).not.toHaveBeenCalled();
    expect(consumeReservation).not.toHaveBeenCalled();
  });

  it('fails before preflight or fence claim when OLX quota wiring is missing', async () => {
    const preparePublish = jest.fn(async () => ({ execute: jest.fn(async () => publishResult) }));
    const adapter = fakeAdapter({ preparePublish });
    const { resolver } = resolverFor(adapter);
    const attempts = memoryPublishAttempts();
    const begin = jest.spyOn(attempts, 'begin');
    const handler = new PublishListingHandler(
      resolver, undefined, undefined, undefined, undefined, attempts,
    );

    await expect(handler.handle({
      operationId: 'op-misconfigured', marketplaceKey: 'olx', marketplaceId: 'm-1',
      listingId: 'l-misconfigured', listingUpdatedAt: '2026-07-16T12:00:00.000Z', input,
    })).rejects.toThrow('missing a quota reservation or publication fence');

    expect(preparePublish).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  });

  it('does not consume quota when another operation owns the listing fence', async () => {
    const publish = jest.fn(async () => publishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const attempts = memoryPublishAttempts();
    await attempts.begin('op-owner', 'l-contended', 'olx', new Date('2026-07-16T12:00:00.000Z'));
    const consumeReservation = jest.fn();
    const handler = makePublishHandler(
      resolver, undefined, undefined, undefined, undefined, attempts, { consumeReservation },
    );

    await expect(handler.handle({
      operationId: 'op-loser', marketplaceKey: 'olx', marketplaceId: 'm-1',
      listingId: 'l-contended', listingUpdatedAt: '2026-07-16T12:00:00.000Z', input,
    })).rejects.toThrow('ambiguous in-flight marketplace publish');

    expect(consumeReservation).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('abandons and reclaims its own fence when quota becomes available on retry', async () => {
    const publish = jest.fn(async () => publishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const attempts = memoryPublishAttempts();
    const markAbandoned = jest.spyOn(attempts, 'markAbandoned');
    const consumeReservation = jest.fn()
      .mockResolvedValueOnce({
        applicable: true, marketplaceKey: 'olx', status: 'exhausted', decision: 'block',
        reason: 'quota_exhausted', requiresOverride: true, consumedUnit: false,
      })
      .mockResolvedValueOnce({
        applicable: true, marketplaceKey: 'olx', status: 'available', decision: 'allow',
        reason: 'free_unit_available', requiresOverride: false, consumedUnit: true,
      });
    const handler = makePublishHandler(
      resolver, undefined, undefined, undefined, undefined, attempts, { consumeReservation },
    );
    const job = {
      operationId: 'op-retry', marketplaceKey: 'olx' as const, marketplaceId: 'm-1',
      listingId: 'l-retry', listingUpdatedAt: '2026-07-16T12:00:00.000Z', input,
    };

    await expect(handler.handle(job)).rejects.toThrow('quota blocks publication');
    await expect(handler.handle(job)).resolves.toMatchObject({ result: publishResult });

    expect(markAbandoned).toHaveBeenCalledWith('op-retry');
    expect(consumeReservation).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('uses the marketplace account access token for real OLX publish jobs', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const create = jest.fn(() => adapter);
    const tokenProvider = {
      getValidAccessToken: jest.fn(async () => 'workspace-access-token'),
    };
    const authenticatedClient = { request: jest.fn() };
    const clientFactory = jest.fn(() => authenticatedClient);
    const handler = makePublishHandler(
      { create },
      undefined,
      undefined,
      tokenProvider,
      clientFactory
    );

    await handler.handle({
      operationId: 'op-1',
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      listingId: 'l-oauth',
      input,
    });

    expect(tokenProvider.getValidAccessToken).toHaveBeenCalledWith('m-1');
    expect(clientFactory).toHaveBeenCalledWith('workspace-access-token');
    expect(create).toHaveBeenCalledWith('olx', authenticatedClient);
  });

  it('uses the marketplace account access token for real OLX update jobs', async () => {
    const updateListing = jest.fn(async () => undefined);
    const adapter = fakeAdapter({ updateListing });
    const create = jest.fn(() => adapter);
    const tokenProvider = {
      getValidAccessToken: jest.fn(async () => 'workspace-access-token'),
    };
    const authenticatedClient = { request: jest.fn() };
    const clientFactory = jest.fn(() => authenticatedClient);
    const currentInput = { ...input, productName: 'Better Widget', price: 44 };
    const getPublishState = jest.fn(async () => ({
      isPublished: true,
      externalListingId: 'olx-123',
      externalUrl: 'https://www.olx.pl/d/oferta/olx-123',
      publishedAt: new Date('2026-07-10T00:00:00.000Z'),
      productUpdatedAt: new Date('2026-07-15T12:00:00.000Z'),
      currentInput,
    }));
    const handler = makePublishHandler(
      { create },
      undefined,
      { publishListing: jest.fn(), getPublishState },
      tokenProvider,
      clientFactory,
      memoryPublishAttempts()
    );

    const result = await handler.handle({
      operationId: 'op-update',
      mode: 'update',
      listingUpdatedAt: '2026-07-15T11:00:00.000Z',
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      listingId: 'l-oauth',
      input: { ...input, category: 'stale-category' },
      changes: { productName: 'Better Widget', price: 44 },
    });

    expect(tokenProvider.getValidAccessToken).toHaveBeenCalledWith('m-1');
    expect(clientFactory).toHaveBeenCalledWith('workspace-access-token');
    expect(create).toHaveBeenCalledWith('olx', authenticatedClient);
    expect(updateListing).toHaveBeenCalledWith(
      'olx-123',
      { productName: 'Better Widget', price: 44 },
      currentInput
    );
    expect(result).toMatchObject({ listingId: 'l-oauth', finalized: true });
    expect(result.result.externalListingId).toBe('olx-123');
  });

  it('rejects a stale update snapshot instead of overwriting newer product data', async () => {
    const updateListing = jest.fn(async () => undefined);
    const adapter = fakeAdapter({ updateListing });
    const handler = makePublishHandler(
      { create: jest.fn(() => adapter) },
      undefined,
      {
        publishListing: jest.fn(),
        getPublishState: jest.fn(async () => ({
          isPublished: true,
          externalListingId: 'olx-123',
          externalUrl: null,
          publishedAt: new Date('2026-07-10T00:00:00.000Z'),
          productUpdatedAt: new Date('2026-07-15T12:00:00.000Z'),
          currentInput: { ...input, productName: 'Newest Widget' },
        })),
      },
      { getValidAccessToken: jest.fn(async () => 'token') },
      () => ({ request: jest.fn() }),
      memoryPublishAttempts()
    );

    await expect(
      handler.handle({
        operationId: 'op-stale-update',
        mode: 'update',
        listingUpdatedAt: '2026-07-15T11:00:00.000Z',
        productUpdatedAt: '2026-07-15T12:00:00.000Z',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-stale',
        input,
        changes: { productName: 'Older Widget' },
      })
    ).rejects.toThrow('product has changed since this marketplace update was queued');
    expect(updateListing).not.toHaveBeenCalled();
  });

  it('does not PUT an update after a newer listing generation was durably accepted', async () => {
    const updateListing = jest.fn(async () => undefined);
    const adapter = fakeAdapter({ updateListing });
    const attempts: PublishAttemptStore = {
      find: jest.fn(async () => null),
      begin: jest.fn(async () => ({
        created: false,
        checkpoint: {
          operationId: 'op-newer-update',
          listingId: 'l-race',
          listingUpdatedAt: new Date('2026-07-15T13:00:00.000Z'),
          marketplaceKey: 'olx',
          status: 'finalized',
          externalListingId: 'olx-123',
          externalUrl: null,
          publishedAt: new Date('2026-07-10T00:00:00.000Z'),
          remoteStatus: null,
          remoteImageUrls: [],
        },
      })),
      markPublished: jest.fn(async () => undefined),
      markFinalized: jest.fn(async () => undefined),
    };
    const handler = makePublishHandler(
      { create: jest.fn(() => adapter) },
      undefined,
      {
        publishListing: jest.fn(),
        getPublishState: jest.fn(async () => ({
          isPublished: true,
          externalListingId: 'olx-123',
          externalUrl: null,
          publishedAt: new Date('2026-07-10T00:00:00.000Z'),
          productUpdatedAt: new Date('2026-07-15T12:00:00.000Z'),
          currentInput: { ...input, productName: 'Current Widget' },
        })),
      },
      { getValidAccessToken: jest.fn(async () => 'token') },
      () => ({ request: jest.fn() }),
      attempts
    );

    await expect(
      handler.handle({
        operationId: 'op-older-update',
        mode: 'update',
        listingUpdatedAt: '2026-07-15T11:00:00.000Z',
        productUpdatedAt: '2026-07-15T12:00:00.000Z',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-race',
        input,
        changes: { productName: 'Current Widget' },
      })
    ).resolves.toMatchObject({ finalized: true });
    expect(updateListing).not.toHaveBeenCalled();
  });

  it('rejects undeclared runtime fields in persisted update jobs', async () => {
    const create = jest.fn(() => fakeAdapter());
    const handler = makePublishHandler({ create });

    await expect(
      handler.handle({
        operationId: 'op-invalid-update',
        mode: 'update',
        listingUpdatedAt: '2026-07-15T11:00:00.000Z',
        productUpdatedAt: '2026-07-15T12:00:00.000Z',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-invalid',
        input,
        changes: { productName: 'Widget', category: 'forbidden' } as never,
      })
    ).rejects.toThrow('may only include productName, description, or price');
    expect(create).not.toHaveBeenCalled();
  });

  it('works without an event publisher', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const { resolver } = resolverFor(adapter);
    const handler = makePublishHandler(resolver);
    await expect(
      handler.handle({
        operationId: 'op-1',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-2',
        input,
      })
    ).resolves.toMatchObject({ listingId: 'l-2', finalized: false });
  });

  it('finalizes the listing via the injected finalizer and defers the event to it', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const { resolver } = resolverFor(adapter);
    const published: DomainEvent[] = [];
    const events: IEventPublisher = {
      publish: async (e) => {
        published.push(e);
      },
    };
    const publishListing = jest.fn(async () => Ok({} as unknown as Listing));
    const handler = makePublishHandler(resolver, events, { publishListing });

    const result = await handler.handle({
      operationId: 'op-1',
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      listingId: 'l-3',
      input,
    });

    // The listing was finalized with the adapter-returned external id + timestamp.
    expect(publishListing).toHaveBeenCalledWith(
      'l-3',
      'olx-99',
      publishResult.externalUrl,
      publishResult.publishedAt,
      null,
      null,
      []
    );
    expect(result.finalized).toBe(true);
    // The handler must NOT double-emit; the finalizer owns the canonical event.
    expect(published).toHaveLength(0);
  });

  it('passes remote status and hosted images from publish results to the finalizer', async () => {
    const remotePublishResult: PublishResult = {
      ...publishResult,
      remoteStatus: 'moderation',
      remoteImageUrls: ['https://ireland.apollo.olxcdn.com/v1/files/photo.jpg'],
    };
    const adapter = fakeAdapter({ publish: jest.fn(async () => remotePublishResult) });
    const { resolver } = resolverFor(adapter);
    const publishListing = jest.fn(async () => Ok({} as unknown as Listing));
    const handler = makePublishHandler(resolver, undefined, { publishListing });

    await expect(
      handler.handle({
        operationId: 'op-remote',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-remote',
        input,
      })
    ).resolves.toMatchObject({ finalized: true });

    expect(publishListing).toHaveBeenCalledWith(
      'l-remote',
      remotePublishResult.externalListingId,
      remotePublishResult.externalUrl,
      remotePublishResult.publishedAt,
      null,
      'moderation',
      remotePublishResult.remoteImageUrls
    );
  });

  it('retries transient token and finalization work without repeating publish', async () => {
    const publish = jest.fn(async () => publishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const getValidAccessToken = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(new ServiceUnavailableError('temporary OAuth failure'))
      .mockResolvedValue('workspace-access-token');
    const publishListing = jest
      .fn()
      .mockResolvedValueOnce(Err(new ServiceUnavailableError('temporary database failure')))
      .mockResolvedValue(Ok({} as unknown as Listing));
    const handler = makePublishHandler(
      resolver,
      undefined,
      { publishListing },
      { getValidAccessToken },
      () => ({ request: jest.fn() })
    );

    await expect(
      handler.handle({
        operationId: 'op-1',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-safe-retry',
        input,
      })
    ).resolves.toMatchObject({ finalized: true });

    expect(getValidAccessToken).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publishListing).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent finalization failures', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const { resolver } = resolverFor(adapter);
    const publishListing = jest.fn(async () => Err(new NotFoundError('Listing missing')));
    const handler = makePublishHandler(resolver, undefined, { publishListing });

    await expect(
      handler.handle({
        operationId: 'op-1',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-permanent',
        input,
      })
    ).rejects.toBeInstanceOf(ListingFinalizationError);
    expect(publishListing).toHaveBeenCalledTimes(1);
  });

  it('resumes finalization from a durable checkpoint without re-publishing', async () => {
    const remotePublishResult: PublishResult = {
      ...publishResult,
      remoteStatus: 'moderation',
      remoteImageUrls: ['https://ireland.apollo.olxcdn.com/v1/files/checkpoint.jpg'],
    };
    const publish = jest.fn(async () => remotePublishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const attempts = memoryPublishAttempts();
    const first = makePublishHandler(
      resolver,
      undefined,
      {
        publishListing: jest.fn(async () =>
          Err(new ServiceUnavailableError('database unavailable'))
        ),
      },
      undefined,
      undefined,
      attempts
    );

    await expect(
      first.handle({
        operationId: 'op-1',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-checkpoint',
        input,
      })
    ).rejects.toBeInstanceOf(ListingFinalizationError);

    const secondFinalizer = jest.fn(async () => Ok({} as unknown as Listing));
    const second = makePublishHandler(
      resolver,
      undefined,
      { publishListing: secondFinalizer },
      undefined,
      undefined,
      attempts
    );
    await expect(
      second.handle({
        operationId: 'op-1',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-checkpoint',
        input,
      })
    ).resolves.toMatchObject({ finalized: true });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(secondFinalizer).toHaveBeenCalledWith(
      'l-checkpoint',
      remotePublishResult.externalListingId,
      remotePublishResult.externalUrl,
      remotePublishResult.publishedAt,
      null,
      'moderation',
      remotePublishResult.remoteImageUrls
    );
  });

  it('throws (does NOT report success) when finalization fails after a successful publish (CR3)', async () => {
    const publish = jest.fn(async () => publishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const published: DomainEvent[] = [];
    const events: IEventPublisher = {
      publish: async (e) => {
        published.push(e);
      },
    };
    const publishListing = jest.fn(async () => Err(new NotFoundError('Listing not found: l-4')));
    const handler = makePublishHandler(
      resolver,
      events,
      { publishListing },
      undefined,
      undefined,
      memoryPublishAttempts()
    );

    // The remote listing was created but the DB was not updated: the handler must
    // surface the failure (so Bull retries from the checkpoint) and NOT emit a fake success event.
    await expect(
      handler.handle({
        operationId: 'op-1',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-4',
        input,
      })
    ).rejects.toBeInstanceOf(ListingFinalizationError);
    expect(published).toHaveLength(0);
    // The durable checkpoint lets a retry reconcile without re-publishing.
    await expect(
      handler.handle({
        operationId: 'op-1',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-4',
        input,
      })
    ).rejects.toMatchObject({ externalListingId: 'olx-99' });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('on retry with an already-published listing, finalizes WITHOUT calling adapter.publish again (CR2/CR3)', async () => {
    const publish = jest.fn(async () => publishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const publishListing = jest.fn(async () => Ok({} as unknown as Listing));
    // The probe reports the listing was already published by a prior attempt.
    const getPublishState = jest.fn(async () => ({
      isPublished: true,
      externalListingId: 'olx-99',
      externalUrl: null,
      publishedAt: publishResult.publishedAt,
    }));
    const attempts = memoryPublishAttempts();
    await attempts.begin('op-1', 'l-5', 'olx', new Date(0));
    await attempts.markPublished('op-1', publishResult);
    const handler = makePublishHandler(
      resolver,
      undefined,
      {
        publishListing,
        getPublishState,
      },
      undefined,
      undefined,
      attempts
    );

    const result = await handler.handle({
      operationId: 'op-1',
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      listingId: 'l-5',
      input,
    });

    // No duplicate POST: the non-idempotent adapter publish must not run.
    expect(publish).not.toHaveBeenCalled();
    expect(result.finalized).toBe(true);
    expect(result.result.externalListingId).toBe('olx-99');
    expect(result.result.externalUrl).toBe(publishResult.externalUrl);
  });

  it('re-publishes an explicitly requested relist even when the listing is currently live', async () => {
    const publish = jest.fn(async () => publishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const publishListing = jest.fn(async () => Ok({} as unknown as Listing));
    const handler = makePublishHandler(
      resolver,
      undefined,
      {
        publishListing,
        getPublishState: async () => ({
          isPublished: true,
          externalListingId: 'olx-old',
          externalUrl: 'https://www.olx.pl/d/oferta/old',
          publishedAt: new Date('2026-07-13T12:00:00.000Z'),
        }),
      },
      undefined,
      undefined,
      memoryPublishAttempts()
    );

    await expect(
      handler.handle({
        operationId: 'op-relist',
        mode: 'relist',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-live',
        input,
      })
    ).resolves.toMatchObject({ finalized: true });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publishListing).toHaveBeenCalledWith(
      'l-live',
      publishResult.externalListingId,
      publishResult.externalUrl,
      publishResult.publishedAt,
      null,
      null,
      []
    );
  });

  it('serializes different publish operation ids for the same listing', async () => {
    const publish = jest.fn(async () => publishResult);
    const attempts = memoryPublishAttempts();
    await attempts.begin('op-first', 'l-race', 'olx', new Date(0));
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const handler = makePublishHandler(
      resolver,
      undefined,
      { publishListing: jest.fn(async () => Ok({} as unknown as Listing)) },
      undefined,
      undefined,
      attempts
    );

    await expect(
      handler.handle({
        operationId: 'op-second',
        mode: 'publish',
        marketplaceKey: 'olx',
        marketplaceId: 'm-1',
        listingId: 'l-race',
        input,
      })
    ).rejects.toThrow('ambiguous in-flight marketplace publish');
    expect(publish).not.toHaveBeenCalled();
  });

  it('coalesces delayed operations enqueued from the same listing generation', async () => {
    const publish = jest.fn(async () => publishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const handler = makePublishHandler(
      resolver,
      undefined,
      undefined,
      undefined,
      undefined,
      memoryPublishAttempts()
    );
    const base = {
      mode: 'relist' as const,
      listingUpdatedAt: '2026-07-14T12:00:00.000Z',
      marketplaceKey: 'olx' as const,
      marketplaceId: 'm-1',
      listingId: 'l-generation',
      input,
    };

    await handler.handle({ ...base, operationId: 'op-generation-a' });
    await handler.handle({ ...base, operationId: 'op-generation-b' });

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('retries a transient checkpoint write without repeating provider publish', async () => {
    const publish = jest.fn(async () => publishResult);
    const attempts = memoryPublishAttempts();
    const persist = attempts.markPublished.bind(attempts);
    const serializationFailure = Object.assign(new Error('serialization failure'), {
      code: '40001',
    });
    attempts.markPublished = jest
      .fn()
      .mockRejectedValueOnce(serializationFailure)
      .mockImplementation(persist);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const handler = makePublishHandler(
      resolver,
      undefined,
      undefined,
      undefined,
      undefined,
      attempts
    );

    await handler.handle({
      operationId: 'op-checkpoint-retry',
      listingUpdatedAt: '2026-07-14T12:00:00.000Z',
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      listingId: 'l-checkpoint-retry',
      input,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(attempts.markPublished).toHaveBeenCalledTimes(2);
  });

  it('publishes normally when the probe reports the listing is not yet published (CR3)', async () => {
    const publish = jest.fn(async () => publishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const publishListing = jest.fn(async () => Ok({} as unknown as Listing));
    const getPublishState = jest.fn(async () => ({
      isPublished: false,
      externalListingId: null,
      externalUrl: null,
      publishedAt: null,
    }));
    const handler = makePublishHandler(resolver, undefined, {
      publishListing,
      getPublishState,
    });

    const result = await handler.handle({
      operationId: 'op-1',
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      listingId: 'l-6',
      input,
    });

    expect(publish).toHaveBeenCalledWith(input);
    expect(publishListing).toHaveBeenCalledWith(
      'l-6',
      'olx-99',
      publishResult.externalUrl,
      publishResult.publishedAt,
      null,
      null,
      []
    );
    expect(result.finalized).toBe(true);
  });
});

describe('HermesRunHandler', () => {
  it('runs the injected engine and emits a completion event', async () => {
    const engine: HermesEngine = {
      run: jest.fn(async () => ({ workspaceId: 'w-1', eventsGenerated: 3 })),
    };
    const published: DomainEvent[] = [];
    const events: IEventPublisher = {
      publish: async (e) => {
        published.push(e);
      },
    };
    const handler = new HermesRunHandler(engine, events);

    const result = await handler.handle({ workspaceId: 'w-1', trigger: 'manual' });

    expect(engine.run).toHaveBeenCalledWith({ workspaceId: 'w-1', trigger: 'manual' });
    expect(result.eventsGenerated).toBe(3);
    expect(published[0].type).toBe('hermes.run.completed');
    expect(published[0].payload).toMatchObject({ eventsGenerated: 3, trigger: 'manual' });
  });
});
