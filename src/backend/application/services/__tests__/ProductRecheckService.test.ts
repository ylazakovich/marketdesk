import { ProductRecheckService } from '../ProductRecheckService';
import { Product } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import { Marketplace } from '../../../domain/entities/Marketplace';
import {
  InMemoryListingRepository, InMemoryMarketplaceRepository, InMemoryProductRepository, money, unwrap,
} from '../../../domain/testkit/support';
import type { ActivityLogEntry, IActivityLogRepository } from '../../../domain/repositories/interfaces/IActivityLogRepository';
import type { MarketplaceCategoryMetadata } from '../../../../shared/types';

const NOW = new Date('2026-07-22T08:00:00.000Z');
const CATEGORY: MarketplaceCategoryMetadata = {
  providerCategoryId: '4000', name: 'Wireless headphones',
  path: ['Electronics', 'Audio', 'Wireless headphones'], source: 'provider_taxonomy',
  confidence: 1, isLeaf: true, taxonomyVerifiedAt: '2026-07-22T07:00:00.000Z',
  taxonomyStaleAt: '2026-07-23T07:00:00.000Z',
};

class ActivityLog implements IActivityLogRepository {
  entries: ActivityLogEntry[] = [];
  async record(entry: ActivityLogEntry) { this.entries.push(entry); }
  async findByWorkspace(workspaceId: string) { return this.entries.filter((entry) => entry.workspaceId === workspaceId); }
  async findByEntity(entityType: string, entityId: string) {
    return this.entries.filter((entry) => entry.entityType === entityType && entry.entityId === entityId);
  }
}

function setup(name = 'Wireless headphones', verifiedCategory = CATEGORY) {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const activityLog = new ActivityLog();
  const product = unwrap(Product.create({
    id: 'product-1', workspaceId: 'workspace-1', sku: 'SKU-1', name,
    description: `${name} in excellent condition with complete accessories.`,
    costPrice: money(50), sellingPrice: money(100), condition: 'good', category: name,
    images: ['https://example.test/image.jpg'], updatedAt: new Date('2026-07-22T06:00:00.000Z'),
  }));
  const marketplace = unwrap(Marketplace.create({
    id: 'marketplace-1', workspaceId: 'workspace-1', key: 'olx', name: 'OLX', connected: true,
  }));
  const listing = unwrap(Listing.create({
    id: 'listing-1', productId: product.id, marketplaceId: marketplace.id,
    price: money(100), marketplaceCategory: CATEGORY, updatedAt: new Date('2026-07-22T06:30:00.000Z'),
  }));
  productRepo.items.set(product.id, product);
  marketplaceRepo.items.set(marketplace.id, marketplace);
  listingRepo.items.set(listing.id, listing);
  const account = {
    id: 'account-1', marketplaceId: marketplace.id, handle: 'OLX', credentials: {},
    status: 'connected' as const, scopes: ['basic'], revision: 7, createdAt: NOW, updatedAt: NOW,
  };
  const accountRepo = {
    findByMarketplaceId: jest.fn(async () => account),
    upsert: jest.fn(), updateConnectedIfUnchanged: jest.fn(),
  };
  const resolver = { verify: jest.fn(async () => verifiedCategory) };
  let auditId = 0;
  const service = new ProductRecheckService(
    productRepo, listingRepo, marketplaceRepo, accountRepo, activityLog,
    async () => resolver, () => `audit-${++auditId}`, () => NOW,
  );
  const input = { productId: product.id, listingId: listing.id, workspaceId: 'workspace-1' };
  return { service, productRepo, listingRepo, marketplaceRepo, activityLog, product, listing, accountRepo, resolver, input };
}

describe('ProductRecheckService', () => {
  it('binds readiness to the exact listing, live taxonomy and connected OAuth account', async () => {
    const { service, activityLog, product, listing, resolver, input } = setup();
    const result = await service.recheck({ ...input, actorId: 'user-1' });

    expect(resolver.verify).toHaveBeenCalledWith(CATEGORY.providerCategoryId);
    expect(result).toMatchObject({
      productId: product.id, listingId: listing.id, marketplaceId: 'marketplace-1',
      workspaceId: 'workspace-1', productUpdatedAt: '2026-07-22T06:00:00.000Z',
      listingUpdatedAt: '2026-07-22T06:30:00.000Z', accountRevision: 7,
      checkedAt: NOW.toISOString(), status: 'ready', canPublish: true, autoApplied: false,
      category: { providerCategoryId: '4000', path: CATEGORY.path, confidence: 1, reason: null },
    });
    expect(result.items).toHaveLength(7);
    expect(result.items.every(({ status }) => status === 'ready')).toBe(true);
    expect(activityLog.entries.map(({ action }) => action)).toEqual([
      'product.recheck.started', 'product.recheck.completed',
    ]);
    expect(JSON.stringify(activityLog.entries)).not.toMatch(/token|secret|credential/i);
  });

  it('never marks a projector in the wireless-headphones category ready', async () => {
    const { service, input } = setup('Portable projector');
    const result = await service.recheck(input);
    expect(result.canPublish).toBe(false);
    expect(result.status).toBe('review');
    expect(result.category.reason).toBe('semantic_mismatch');
  });

  it('returns only a live-verified suggestion and marks it confirmation-required without applying it', async () => {
    const { service, productRepo, product, resolver, input } = setup('Portable projector');
    productRepo.items.set(product.id, Product.reconstitute({
      id: product.id, workspaceId: product.workspaceId, sku: product.sku, name: product.name,
      description: product.description, costPrice: product.costPrice, sellingPrice: product.sellingPrice,
      condition: product.condition, category: product.category,
      categoryProvenance: {
        status: 'conflict', currentSources: null, detectedAt: NOW.toISOString(),
        candidates: [{
          marketplaceKey: 'olx', marketplaceId: 'marketplace-1', listingId: 'listing-1',
          providerCategoryId: '5000', name: 'Projectors', path: ['Electronics', 'TV and video', 'Projectors'],
          taxonomyVerifiedAt: NOW.toISOString(), syncedAt: NOW.toISOString(),
        }],
      },
      status: product.status, tags: [...product.tags], images: [...product.images],
      createdAt: product.createdAt, updatedAt: product.updatedAt,
    }));
    resolver.verify.mockImplementation(async (id: string) => id === '5000'
      ? { ...CATEGORY, providerCategoryId: '5000', name: 'Projectors', path: ['Electronics', 'TV and video', 'Projectors'] }
      : CATEGORY);

    const result = await service.recheck(input);
    expect(result.autoApplied).toBe(false);
    expect(result.category.suggestion).toMatchObject({ providerCategoryId: '5000', isLeaf: true });
    expect(result.category.confirmationRequired).toBe(true);
  });

  it('uses the current provider response and blocks stale taxonomy evidence', async () => {
    const stale = { ...CATEGORY, taxonomyVerifiedAt: '2026-07-20T07:00:00.000Z', taxonomyStaleAt: '2026-07-21T07:00:00.000Z' };
    const { service, input } = setup('Wireless headphones', stale);
    const result = await service.recheck(input);
    expect(result.canPublish).toBe(false);
    expect(result.category.reason).toBe('taxonomy_stale');
  });

  it('fails closed and records a terminal audit when live taxonomy cannot be verified', async () => {
    const { service, resolver, activityLog, input } = setup();
    resolver.verify.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(service.recheck(input)).rejects.toThrow('Could not verify the current OLX taxonomy');
    expect(activityLog.entries.map(({ action }) => action)).toEqual([
      'product.recheck.started', 'product.recheck.failed',
    ]);
    expect(activityLog.entries[1].metadata).toMatchObject({ errorCode: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(activityLog.entries)).not.toContain('provider unavailable');
  });

  it('rejects a result if the product changes while checking and audits failure', async () => {
    const { service, productRepo, activityLog, product, input } = setup();
    const changed = Product.reconstitute({
      id: product.id, workspaceId: product.workspaceId, sku: product.sku, name: product.name,
      description: product.description, costPrice: product.costPrice, sellingPrice: product.sellingPrice,
      condition: product.condition, category: product.category, categoryProvenance: product.categoryProvenance,
      status: product.status, tags: [...product.tags], images: [...product.images], createdAt: product.createdAt,
      updatedAt: new Date('2026-07-22T07:45:00.000Z'),
    });
    jest.spyOn(productRepo, 'findByIdForWorkspace').mockResolvedValueOnce(product).mockResolvedValueOnce(changed);
    await expect(service.recheck(input)).rejects.toThrow('Product, listing, or marketplace changed');
    expect(activityLog.entries.map(({ action }) => action)).toEqual([
      'product.recheck.started', 'product.recheck.failed',
    ]);
  });

  it('rejects a result if the target listing changes while checking', async () => {
    const { service, listingRepo, listing, input } = setup();
    const changed = Listing.reconstitute({
      id: listing.id, productId: listing.productId, marketplaceId: listing.marketplaceId,
      price: money(120), marketplaceListingId: listing.marketplaceListingId,
      externalUrl: listing.externalUrl, status: listing.status, remoteStatus: listing.remoteStatus,
      marketplaceCategory: listing.marketplaceCategory, views: listing.views, watchers: listing.watchers,
      messages: listing.messages, publishedAt: listing.publishedAt, expiresAt: listing.expiresAt,
      syncError: listing.syncError, lastSyncAt: listing.lastSyncAt, createdAt: listing.createdAt,
      updatedAt: new Date('2026-07-22T07:45:00.000Z'),
    });
    jest.spyOn(listingRepo, 'findByIdForWorkspace').mockResolvedValueOnce(listing).mockResolvedValueOnce(changed);
    await expect(service.recheck(input)).rejects.toThrow('Product, listing, or marketplace changed');
  });

  it('returns actionable fix items without attempting taxonomy when the OAuth account is disconnected', async () => {
    const { service, accountRepo, resolver, input } = setup();
    accountRepo.findByMarketplaceId.mockResolvedValue({
      id: 'account-1', marketplaceId: 'marketplace-1', handle: 'OLX', credentials: {},
      status: 'disconnected', scopes: ['basic'], revision: 8, createdAt: NOW, updatedAt: NOW,
    });
    const result = await service.recheck(input);
    expect(result.canPublish).toBe(false);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'marketplace', status: 'fix', editField: 'marketplace' }),
      expect.objectContaining({ key: 'category', status: 'fix' }),
    ]));
    expect(resolver.verify).not.toHaveBeenCalled();
  });

  it('rejects a result if the OAuth account revision changes while checking', async () => {
    const { service, accountRepo, activityLog, input } = setup();
    const initial = await accountRepo.findByMarketplaceId('marketplace-1');
    accountRepo.findByMarketplaceId
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial!, revision: 8 });
    await expect(service.recheck(input)).rejects.toThrow('Product, listing, or marketplace changed');
    expect(activityLog.entries.map(({ action }) => action)).toEqual([
      'product.recheck.started', 'product.recheck.failed',
    ]);
  });

  it('rejects cross-workspace and mismatched product/listing identities', async () => {
    const { service, product, input } = setup();
    await expect(service.recheck({ ...input, workspaceId: 'workspace-2' }))
      .rejects.toThrow(`Product not found: ${product.id}`);
    await expect(service.recheck({ ...input, productId: 'other-product' }))
      .rejects.toThrow('Product not found: other-product');
  });
});
