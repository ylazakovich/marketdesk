import {
  ProductCategorySyncService,
  selectProductCategoryTriggerListings,
} from '../ProductCategorySyncService';
import { Product } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import { Marketplace } from '../../../domain/entities/Marketplace';
import type { MarketplaceCategoryMetadata } from '../../../../shared/types';
import type { ActivityLogEntry, IActivityLogRepository } from '../../../domain/repositories/interfaces/IActivityLogRepository';
import {
  InMemoryEventRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../../domain/testkit/support';

const now = new Date('2026-01-10T12:00:00.000Z');

function category(
  providerCategoryId: string,
  name: string,
  path: string[],
  overrides: Partial<MarketplaceCategoryMetadata> = {},
): MarketplaceCategoryMetadata {
  return {
    providerCategoryId,
    name,
    path,
    source: 'provider_taxonomy',
    confidence: 1,
    isLeaf: true,
    taxonomyVerifiedAt: '2026-01-10T11:55:00.000Z',
    taxonomyStaleAt: '2026-01-10T13:00:00.000Z',
    ...overrides,
  };
}

function product(categoryName = 'Electronics', name = 'Generic electronic device') {
  return unwrap(Product.create({
    id: 'product-1',
    workspaceId: 'workspace-1',
    sku: 'SKU-1',
    name,
    description: 'A detailed product description suitable for category reconciliation.',
    costPrice: money(10),
    sellingPrice: money(100),
    condition: 'good',
    category: categoryName,
    status: 'active',
  }));
}

function listing(id: string, marketplaceCategory: MarketplaceCategoryMetadata | null, marketplaceId = 'marketplace-1') {
  return unwrap(Listing.create({
    id,
    productId: 'product-1',
    marketplaceId,
    marketplaceListingId: `remote-${id}`,
    price: money(100),
    status: 'live',
    marketplaceCategory,
    lastSyncAt: now,
  }));
}

class ActivityLog implements IActivityLogRepository {
  entries: ActivityLogEntry[] = [];
  async record(entry: ActivityLogEntry) { this.entries.push(entry); }
  async findByWorkspace(workspaceId: string) { return this.entries.filter((entry) => entry.workspaceId === workspaceId); }
  async findByEntity(entityType: string, entityId: string) {
    return this.entries.filter((entry) => entry.entityType === entityType && entry.entityId === entityId);
  }
}

function setup(initialProduct = product()) {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const activityLog = new ActivityLog();
  const eventRepo = new InMemoryEventRepository();
  productRepo.items.set(initialProduct.id, initialProduct);
  marketplaceRepo.items.set('marketplace-1', unwrap(Marketplace.create({
    id: 'marketplace-1', workspaceId: 'workspace-1', key: 'olx', name: 'OLX', connected: true,
  })));
  const repositories = { productRepo, listingRepo, marketplaceRepo, activityLog, eventRepo };
  let ids = 0;
  const service = new ProductCategorySyncService(async (work) => work(repositories), () => `category-event-${++ids}`);
  return { service, repositories, activityLog, eventRepo };
}

const projector = category('100', 'Projectors', ['Electronics', 'Video', 'Projectors']);
const headphones = category('200', 'Wireless headphones', ['Electronics', 'Audio', 'Wireless headphones']);

describe('selectProductCategoryTriggerListings', () => {
  it('skips an arbitrary draft first listing and selects one eligible trigger per product', () => {
    const draft = unwrap(Listing.create({
      id: 'listing-draft', productId: 'product-1', marketplaceId: 'marketplace-1',
      price: money(100), status: 'draft', marketplaceCategory: null,
    }));
    const live = listing('listing-live', projector);

    expect(selectProductCategoryTriggerListings([draft, live])).toEqual([live]);
  });
});

describe('ProductCategorySyncService', () => {
  it('synchronizes one trusted live OLX leaf with full provenance and one real-change activity', async () => {
    const { service, repositories, activityLog } = setup();
    repositories.listingRepo.items.set('listing-1', listing('listing-1', projector));

    const result = await service.reconcile({
      workspaceId: 'workspace-1', listingId: 'listing-1', trigger: 'manual', actorId: 'user-1', now,
    });

    expect(result).toEqual({ outcome: 'synced', categoryChanged: true });
    const saved = repositories.productRepo.items.get('product-1')!;
    expect(saved.category).toBe('Projectors');
    expect(saved.categoryProvenance).toEqual({
      status: 'synced',
      sources: [expect.objectContaining({
        marketplaceKey: 'olx', marketplaceId: 'marketplace-1', listingId: 'listing-1',
        providerCategoryId: '100', path: projector.path,
        taxonomyVerifiedAt: projector.taxonomyVerifiedAt,
      })],
    });
    expect(activityLog.entries).toEqual([
      expect.objectContaining({ action: 'product.category_synced', actorType: 'user', actorId: 'user-1' }),
    ]);
  });

  it('is idempotent when category identity and agreeing sources are unchanged', async () => {
    const { service, repositories, activityLog } = setup();
    repositories.listingRepo.items.set('listing-1', listing('listing-1', projector));
    await service.reconcile({ workspaceId: 'workspace-1', listingId: 'listing-1', trigger: 'scheduled', now });
    const updatedAt = repositories.productRepo.items.get('product-1')!.updatedAt.getTime();

    const replay = await service.reconcile({ workspaceId: 'workspace-1', listingId: 'listing-1', trigger: 'scheduled', now });

    expect(replay).toEqual({ outcome: 'unchanged', categoryChanged: false });
    expect(repositories.productRepo.items.get('product-1')!.updatedAt.getTime()).toBe(updatedAt);
    expect(activityLog.entries).toHaveLength(1);
  });

  it('does not clear category or provenance for missing or stale evidence', async () => {
    const initial = product();
    const { service, repositories } = setup(initial);
    repositories.listingRepo.items.set('listing-1', listing('listing-1', projector));
    await service.reconcile({ workspaceId: 'workspace-1', listingId: 'listing-1', trigger: 'scheduled', now });
    const before = initial.categoryProvenance;
    const stale = category('300', 'Cameras', ['Electronics', 'Cameras'], {
      taxonomyVerifiedAt: '2026-01-09T10:00:00.000Z',
      taxonomyStaleAt: '2026-01-09T11:00:00.000Z',
    });
    repositories.listingRepo.items.set('listing-2', listing('listing-2', stale));

    expect(await service.reconcile({ workspaceId: 'workspace-1', listingId: 'listing-2', trigger: 'scheduled', now }))
      .toMatchObject({ outcome: 'ignored', categoryChanged: false });
    expect(initial.category).toBe('Projectors');
    expect(initial.categoryProvenance).toEqual(before);
  });

  it('records deterministic conflict without last-write-wins and creates one review event on replay', async () => {
    const initial = product();
    const { service, repositories, activityLog, eventRepo } = setup(initial);
    repositories.listingRepo.items.set('listing-a', listing('listing-a', projector));
    repositories.listingRepo.items.set('listing-b', listing('listing-b', headphones));

    const first = await service.reconcile({ workspaceId: 'workspace-1', listingId: 'listing-b', trigger: 'scheduled', now });
    const replay = await service.reconcile({ workspaceId: 'workspace-1', listingId: 'listing-a', trigger: 'scheduled', now });

    expect(first).toEqual({ outcome: 'conflict', categoryChanged: false });
    expect(replay).toEqual({ outcome: 'unchanged', categoryChanged: false });
    expect(initial.category).toBe('Electronics');
    expect(initial.categoryProvenance).toMatchObject({
      status: 'conflict', currentSources: null,
      candidates: [expect.any(Object), expect.any(Object)],
    });
    const events = await eventRepo.findPendingReview('workspace-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'product_category_conflict', status: 'pending_review' });
    expect(events[0].proposedChange).toMatchObject({
      kind: 'product_category_conflict', currentCategory: 'Electronics', candidates: expect.any(Array),
    });
    expect(activityLog.entries).toHaveLength(0);
  });

  it('persists refreshed conflict evidence without duplicating review or activity events', async () => {
    const initial = product();
    const { service, repositories, activityLog, eventRepo } = setup(initial);
    const firstListing = listing('listing-a', projector);
    const secondListing = listing('listing-b', headphones);
    repositories.listingRepo.items.set('listing-a', firstListing);
    repositories.listingRepo.items.set('listing-b', secondListing);
    await service.reconcile({ workspaceId: 'workspace-1', listingId: 'listing-b', trigger: 'scheduled', now });
    const detectedAt = initial.categoryProvenance?.status === 'conflict'
      ? initial.categoryProvenance.detectedAt
      : null;

    const refreshedAt = new Date('2026-01-10T12:30:00.000Z');
    const refreshedVerifiedAt = '2026-01-10T12:25:00.000Z';
    firstListing.recordMarketplaceCategory({
      ...projector,
      taxonomyVerifiedAt: refreshedVerifiedAt,
      taxonomyStaleAt: '2026-01-10T14:00:00.000Z',
    });
    secondListing.recordMarketplaceCategory({
      ...headphones,
      taxonomyVerifiedAt: refreshedVerifiedAt,
      taxonomyStaleAt: '2026-01-10T14:00:00.000Z',
    });
    firstListing.recordSyncStats({}, refreshedAt);
    secondListing.recordSyncStats({}, refreshedAt);

    expect(await service.reconcile({
      workspaceId: 'workspace-1', listingId: 'listing-a', trigger: 'scheduled', now: refreshedAt,
    })).toEqual({ outcome: 'unchanged', categoryChanged: false });
    expect(initial.categoryProvenance).toMatchObject({
      status: 'conflict',
      detectedAt,
      candidates: [
        expect.objectContaining({ taxonomyVerifiedAt: refreshedVerifiedAt, syncedAt: refreshedAt.toISOString() }),
        expect.objectContaining({ taxonomyVerifiedAt: refreshedVerifiedAt, syncedAt: refreshedAt.toISOString() }),
      ],
    });
    expect(await eventRepo.findPendingReview('workspace-1')).toHaveLength(1);
    expect(activityLog.entries).toHaveLength(0);
  });

  it('uses stable product identity rather than stale Product.category for semantic validation', async () => {
    const initial = product('Wireless headphones', 'AOPEN QH11 projector');
    const { service, repositories } = setup(initial);
    repositories.listingRepo.items.set('listing-1', listing('listing-1', projector));

    const result = await service.reconcile({ workspaceId: 'workspace-1', listingId: 'listing-1', trigger: 'manual', now });

    expect(result).toEqual({ outcome: 'synced', categoryChanged: true });
    expect(initial.category).toBe('Projectors');
  });

  it('fails closed for a cross-workspace trigger listing', async () => {
    const { service, repositories } = setup();
    repositories.listingRepo.items.set('listing-1', listing('listing-1', projector));
    repositories.listingRepo.listingWorkspaces.set('listing-1', 'workspace-1');

    await expect(service.reconcile({
      workspaceId: 'workspace-other', listingId: 'listing-1', trigger: 'manual', now,
    })).rejects.toThrow('Listing not found');
    expect(repositories.productRepo.items.get('product-1')!.category).toBe('Electronics');
  });
});
