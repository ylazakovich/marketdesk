import { ApproveHermesEventUseCase } from '../usecases/ApproveHermesEventUseCase';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import { Marketplace } from '../../domain/entities/Marketplace';
import { HermesEvent } from '../../domain/entities/HermesEvent';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryEventRepository,
  RecordingEventPublisher,
  unwrap,
  money,
} from '../../domain/testkit/support';
import {
  InMemoryActivityLogRepository,
  RecordingPriceHistoryRecorder,
  RecordingJobQueue,
  idFactory,
} from '../testkit/support';
import type { PublishListingJob } from '../ports/IJobQueue';
import type { OlxPublicationQuotaService } from '../services/OlxPublicationQuotaService';
import { GuardrailViolationError } from '../../domain/shared/DomainError';

function makeProduct() {
  return unwrap(
    Product.create({
      id: 'prod-1',
      workspaceId: 'ws-1',
      sku: 'SKU-1',
      name: 'Lamp',
      description: 'A beautiful vintage brass lamp in excellent condition.',
      costPrice: money(50),
      sellingPrice: money(100),
      condition: 'good',
      category: 'home',
    })
  );
}

function makeListing() {
  return unwrap(
    Listing.create({
      id: 'lst-1',
      productId: 'prod-1',
      marketplaceId: 'mp-1',
      price: money(100),
    })
  );
}

function setup(
  accountStatus: 'connected' | 'missing' = 'connected',
  olxQuota?: OlxPublicationQuotaService,
) {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const eventRepo = new InMemoryEventRepository();
  const activityLog = new InMemoryActivityLogRepository();
  const priceHistory = new RecordingPriceHistoryRecorder();
  const publishQueue = new RecordingJobQueue<PublishListingJob>();
  const publisher = new RecordingEventPublisher();

  const product = makeProduct();
  const listing = makeListing();
  const marketplace = unwrap(
    Marketplace.create({
      id: 'mp-1',
      workspaceId: 'ws-1',
      key: 'olx',
      name: 'OLX',
      connected: true,
    })
  );
  productRepo.items.set(product.id, product);
  listingRepo.items.set(listing.id, listing);
  marketplaceRepo.items.set(marketplace.id, marketplace);
  const accountRepo = {
    findByMarketplaceId: async () =>
      accountStatus === 'connected'
        ? {
            id: 'account-1',
            marketplaceId: marketplace.id,
            handle: 'OLX account',
            credentials: {},
            status: 'connected' as const,
            scopes: ['basic'],
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null,
    upsert: async () => {
      throw new Error('not used');
    },
    updateConnectedIfUnchanged: async () => {
      throw new Error('not used');
    },
  };

  const useCase = new ApproveHermesEventUseCase(
    eventRepo,
    productRepo,
    listingRepo,
    marketplaceRepo,
    activityLog,
    priceHistory,
    publishQueue,
    publisher,
    idFactory('rec'),
    accountRepo,
    olxQuota,
  );

  return {
    useCase,
    productRepo,
    eventRepo,
    activityLog,
    priceHistory,
    publisher,
    product,
    listingRepo,
    publishQueue,
  };
}

describe('ApproveHermesEventUseCase', () => {
  it('applies a pending price change: updates product, records history and marks applied', async () => {
    const { useCase, eventRepo, product, priceHistory, activityLog, publisher } = setup();

    const event = unwrap(
      HermesEvent.create({
        id: 'evt-1',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower the price',
        detail: 'Move stock faster',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({
      eventId: 'evt-1',
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    const applied = unwrap(result);
    expect(applied.status).toBe('applied');
    expect(applied.resolvedAt).not.toBeNull();
    expect(product.sellingPrice.amount).toBe(90);
    expect(priceHistory.records).toHaveLength(1);
    expect(priceHistory.records[0]).toMatchObject({
      listingId: 'lst-1',
      oldPrice: 100,
      newPrice: 90,
      changedBy: 'hermes',
    });
    expect(activityLog.entries.map((e) => e.action)).toContain('hermes_event.approved');
    expect(publisher.published.map((e) => e.type)).toContain('hermes.event.applied');
  });

  it('queues marketplace updates for approved title changes on live listings', async () => {
    const { useCase, eventRepo, listingRepo, publishQueue, activityLog } = setup();
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-123',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-title',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'listing_optimization',
        severity: 'info',
        title: 'Improve title',
        proposedChange: { kind: 'title', field: 'title', from: 'Lamp', to: 'Better Lamp' },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1', actorId: 'user-1' });

    expect(result.isOk()).toBe(true);
    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0]).toMatchObject({
      options: { jobId: 'update:rec-1' },
      data: {
        operationId: 'rec-1',
        mode: 'update',
        listingId: 'lst-live',
        marketplaceId: 'mp-1',
        changes: { productName: 'Better Lamp' },
        input: expect.objectContaining({ productName: 'Better Lamp' }),
      },
    });
    expect(activityLog.entries[0].metadata.marketplaceSync).toMatchObject({
      status: 'queued',
      operations: [expect.objectContaining({ operationId: 'rec-1', listingId: 'lst-live' })],
    });
  });

  it('queues marketplace updates for approved descriptions on live listings', async () => {
    const { useCase, eventRepo, listingRepo, publishQueue, activityLog } = setup();
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live-description',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-desc',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const description = 'A richer product description for buyers.';
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-description-live',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'listing_optimization',
        severity: 'info',
        title: 'Improve description',
        proposedChange: {
          kind: 'description',
          field: 'description',
          from: 'Old description',
          to: description,
        },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1', actorId: 'user-1' });

    expect(result.isOk()).toBe(true);
    expect(publishQueue.jobs[0].data).toMatchObject({
      mode: 'update',
      listingId: 'lst-live-description',
      changes: { description },
    });
    expect(activityLog.entries[0].metadata.marketplaceSync).toMatchObject({ status: 'queued' });
  });

  it('keeps draft listings local-only for approved description changes', async () => {
    const { useCase, eventRepo, publishQueue, activityLog } = setup();
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-description',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'listing_optimization',
        severity: 'info',
        title: 'Improve description',
        proposedChange: {
          kind: 'description',
          field: 'description',
          from: 'Old description',
          to: 'A richer product description for buyers.',
        },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1', actorId: 'user-1' });

    expect(result.isOk()).toBe(true);
    expect(publishQueue.jobs).toHaveLength(0);
    expect(activityLog.entries[0].metadata.marketplaceSync).toEqual({ status: 'not_required' });
  });

  it('records retry-required sync state when a live listing account is disconnected', async () => {
    const { useCase, eventRepo, listingRepo, publishQueue, activityLog } = setup('missing');
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live-disconnected',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-missing-account',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-title-disconnected',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'listing_optimization',
        severity: 'warning',
        title: 'Improve title',
        proposedChange: { kind: 'title', field: 'title', from: 'Lamp', to: 'Better Lamp' },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1', actorId: 'user-1' });

    expect(result.isOk()).toBe(true);
    expect(publishQueue.jobs).toHaveLength(0);
    expect(activityLog.entries[0].metadata.marketplaceSync).toEqual({
      status: 'retry_required',
      skippedLiveListings: [
        { listingId: 'lst-live-disconnected', reason: 'marketplace_account_not_connected' },
      ],
    });
  });

  it('updates listing price locally and queues remote price update for live listings', async () => {
    const { useCase, eventRepo, listingRepo, publishQueue } = setup();
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live-price',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-456',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-price',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1', actorId: 'user-1' });

    expect(result.isOk()).toBe(true);
    expect((await listingRepo.findById('lst-live-price'))?.price.amount).toBe(90);
    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0].data).toMatchObject({
      mode: 'update',
      listingId: 'lst-live-price',
      changes: { price: 90 },
      input: expect.objectContaining({ price: 90 }),
    });
  });

  it('rejects approving an event that is not pending_review', async () => {
    const { useCase, eventRepo } = setup();

    const event = unwrap(
      HermesEvent.create({
        id: 'evt-2',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower the price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    unwrap(event.approve()); // move to applied
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: 'evt-2', workspaceId: 'ws-1' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('INVALID_STATE');
  });

  it('returns NOT_FOUND for an unknown event', async () => {
    const { useCase } = setup();
    const result = await useCase.execute({ eventId: 'nope', workspaceId: 'ws-1' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('does not enqueue a relist when the OAuth account is disconnected', async () => {
    const { useCase, eventRepo, publishQueue } = setup('missing');
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-relist',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'needs_relisting',
        severity: 'warning',
        title: 'Relist product',
        proposedChange: { kind: 'relist', listingIds: ['lst-1'] },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('INVALID_STATE');
    expect(publishQueue.jobs).toHaveLength(0);
  });

  it('returns a structured guard error when the OLX quota guard is unavailable', async () => {
    const { useCase, eventRepo, publishQueue } = setup();
    const event = unwrap(HermesEvent.create({
      id: 'evt-relist-no-guard', workspaceId: 'ws-1', productId: 'prod-1',
      type: 'needs_relisting', severity: 'warning', title: 'Relist product',
      proposedChange: { kind: 'relist', listingIds: ['lst-1'] },
    }));
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(GuardrailViolationError);
      expect(result.error.details).toEqual({
        quotaDecision: {
          applicable: true, marketplaceKey: 'olx', status: 'unknown', decision: 'block',
          reason: 'quota_guard_unavailable', requiresOverride: true,
        },
      });
    }
    expect(publishQueue.jobs).toHaveLength(0);
  });

  it('does not retry already-authorized relists when a later quota decision blocks', async () => {
    const authorize = jest.fn()
      .mockResolvedValueOnce({ decision: 'allow' })
      .mockResolvedValueOnce({ decision: 'block' });
    const quotaService = {
      authorize,
      guardError: () => new GuardrailViolationError('quota blocked'),
    } as unknown as OlxPublicationQuotaService;
    const { useCase, eventRepo, listingRepo, publishQueue } = setup('connected', quotaService);
    const secondListing = unwrap(Listing.create({
      id: 'lst-2', productId: 'prod-1', marketplaceId: 'mp-1', price: money(100),
    }));
    listingRepo.items.set(secondListing.id, secondListing);
    const event = unwrap(HermesEvent.create({
      id: 'evt-relist-preflight', workspaceId: 'ws-1', productId: 'prod-1',
      type: 'needs_relisting', severity: 'warning', title: 'Relist product',
      proposedChange: { kind: 'relist', listingIds: ['lst-1', 'lst-2'] },
    }));
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1' });

    expect(result.isOk()).toBe(true);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0].data.listingId).toBe('lst-1');
    expect((await eventRepo.findById(event.id))?.status).toBe('applied');
  });

  it('returns NOT_FOUND when approving an event from another workspace (IDOR, S2)', async () => {
    const { useCase, eventRepo, product } = setup();
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-x',
        workspaceId: 'ws-1',
        productId: product.id,
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower the price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: 'evt-x', workspaceId: 'ws-other' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('NOT_FOUND');
    // The event must remain untouched (still pending_review) for its real owner.
    const reloaded = await eventRepo.findById('evt-x');
    expect(reloaded!.status).toBe('pending_review');
  });
});
