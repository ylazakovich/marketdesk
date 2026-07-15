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
import { NotFoundError, ServiceUnavailableError, InvalidStateError } from '../../../domain/shared/DomainError';
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
        marketplaceKey,
        status: 'publishing',
        externalListingId: null,
        externalUrl: null,
        publishedAt: null,
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
      });
    },
    markFinalized: async (operationId) => {
      const existing = attempts.get(operationId)!;
      attempts.set(operationId, { ...existing, status: 'finalized' });
    },
  };
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
      getValidAccessToken: jest.fn(async () => 'workspace-access-token'),
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

    expect(tokenProvider.getValidAccessToken).toHaveBeenCalledWith('m-1');
    expect(clientFactory).toHaveBeenCalledWith('workspace-access-token');
    expect(create).toHaveBeenCalledWith('olx', authenticatedClient);
    expect(adapter.sync).toHaveBeenCalledWith(['olx-1']);
  });

  it('keeps non-OLX sync on the existing generic adapter path', async () => {
    const adapter = fakeAdapter({ sync: jest.fn(async () => []) });
    const create = jest.fn(() => adapter);
    const tokenProvider = {
      getValidAccessToken: jest.fn(async () => 'unused-token'),
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

    expect(tokenProvider.getValidAccessToken).not.toHaveBeenCalled();
    expect(clientFactory).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('allegro');
  });

  it('records marketplace error when OLX credentials are unavailable', async () => {
    const create = jest.fn(() => fakeAdapter());
    const tokenProvider = {
      getValidAccessToken: jest.fn(async () => {
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
    expect(saved[0].lastSyncAt).not.toBeNull();
    expect(marketplaceStore.save).toHaveBeenCalled();
    expect(marketplace.errorCount).toBe(0); // reset on success
    expect(marketplace.lastSyncAt).not.toBeNull();
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

    await handler.handle({ marketplaceKey: 'olx', marketplaceId: 'm-1', externalListingIds: ['ext-1'] });

    expect(listing.views).toBe(10);
    expect(listing.watchers).toBe(4);
    expect(listing.messages).toBe(1);
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
    const handler = new PublishListingHandler(resolver, events);

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

  it('uses the marketplace account access token for real OLX publish jobs', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const create = jest.fn(() => adapter);
    const tokenProvider = {
      getValidAccessToken: jest.fn(async () => 'workspace-access-token'),
    };
    const authenticatedClient = { request: jest.fn() };
    const clientFactory = jest.fn(() => authenticatedClient);
    const handler = new PublishListingHandler(
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

  it('works without an event publisher', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const { resolver } = resolverFor(adapter);
    const handler = new PublishListingHandler(resolver);
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
    const handler = new PublishListingHandler(resolver, events, { publishListing });

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
      publishResult.publishedAt
    );
    expect(result.finalized).toBe(true);
    // The handler must NOT double-emit; the finalizer owns the canonical event.
    expect(published).toHaveLength(0);
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
    const handler = new PublishListingHandler(
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
    const handler = new PublishListingHandler(resolver, undefined, { publishListing });

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
    const publish = jest.fn(async () => publishResult);
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const attempts = memoryPublishAttempts();
    const first = new PublishListingHandler(
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
    const second = new PublishListingHandler(
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
      publishResult.externalListingId,
      publishResult.externalUrl,
      publishResult.publishedAt
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
    const handler = new PublishListingHandler(
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
    const handler = new PublishListingHandler(
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
    const handler = new PublishListingHandler(
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
      publishResult.publishedAt
    );
  });

  it('serializes different publish operation ids for the same listing', async () => {
    const publish = jest.fn(async () => publishResult);
    const attempts = memoryPublishAttempts();
    await attempts.begin('op-first', 'l-race', 'olx', new Date(0));
    const adapter = fakeAdapter({ publish });
    const { resolver } = resolverFor(adapter);
    const handler = new PublishListingHandler(
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
    const handler = new PublishListingHandler(
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
    const handler = new PublishListingHandler(
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
    const handler = new PublishListingHandler(resolver, undefined, {
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
      publishResult.publishedAt
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
