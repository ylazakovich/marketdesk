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

function setup(accountStatus: 'connected' | 'missing' = 'connected') {
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
    accountRepo
  );

  return {
    useCase,
    productRepo,
    eventRepo,
    activityLog,
    priceHistory,
    publisher,
    product,
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
