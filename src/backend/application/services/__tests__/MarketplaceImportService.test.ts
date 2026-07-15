import { MarketplaceImportService } from '../MarketplaceImportService';
import { Marketplace } from '../../../domain/entities/Marketplace';
import { Listing } from '../../../domain/entities/Listing';
import type { IMarketplaceAdapter, ImportedMarketplaceListing } from '../../../domain/services/MarketplaceAdapter';
import type { MarketplaceAccountRecord } from '../MarketplaceOAuthService';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  money,
  unwrap,
} from '../../../domain/testkit/support';
import { InMemoryActivityLogRepository, idFactory } from '../../testkit/support';

const connectedAccount: MarketplaceAccountRecord = {
  id: 'account-1',
  marketplaceId: 'marketplace-1',
  handle: 'seller',
  credentials: {},
  status: 'connected',
  scopes: ['read', 'write'],
  createdAt: new Date('2026-07-15T00:00:00.000Z'),
  updatedAt: new Date('2026-07-15T00:00:00.000Z'),
};

function remoteListing(overrides: Partial<ImportedMarketplaceListing> = {}): ImportedMarketplaceListing {
  return {
    externalListingId: 'olx-1',
    externalUrl: 'https://www.olx.pl/d/oferta/olx-1',
    title: 'Remote camera',
    description: 'Existing OLX advert with enough seller supplied detail.',
    price: 100,
    currency: 'PLN',
    status: 'live',
    remoteStatus: 'active',
    category: 'Electronics',
    imageUrls: ['https://img/1.jpg'],
    remoteUpdatedAt: new Date('2026-07-14T00:00:00.000Z'),
    metrics: { views: 7, watchers: 2, messages: 1 },
    ...overrides,
  };
}

function createService(remote: ImportedMarketplaceListing[], existing: Listing[] = []) {
  const marketplace = unwrap(
    Marketplace.create({
      id: 'marketplace-1',
      workspaceId: 'workspace-1',
      key: 'olx',
      name: 'OLX',
      connected: true,
    }),
  );
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  marketplaceRepo.items.set(marketplace.id, marketplace);
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  for (const listing of existing) listingRepo.items.set(listing.id, listing);
  const activityLog = new InMemoryActivityLogRepository();
  const adapter = {
    getKey: () => 'olx',
    publish: jest.fn(),
    updateListing: jest.fn(),
    delist: jest.fn(),
    sync: jest.fn(),
    fetchListing: jest.fn(),
    listOwnedListings: jest.fn(async () => remote),
  } as unknown as IMarketplaceAdapter;
  const create = jest.fn(() => adapter);
  const getValidAccessToken = jest.fn(async () => 'access-token');
  const authenticatedHttpClient = jest.fn(() => ({ request: jest.fn() }));
  const service = new MarketplaceImportService(
    marketplaceRepo,
    productRepo,
    listingRepo,
    { findByMarketplaceId: jest.fn(async () => connectedAccount) } as any,
    { create },
    { getValidAccessToken },
    authenticatedHttpClient,
    activityLog,
    idFactory('import'),
  );
  return {
    service,
    adapter,
    create,
    getValidAccessToken,
    authenticatedHttpClient,
    productRepo,
    listingRepo,
    activityLog,
  };
}

describe('MarketplaceImportService', () => {
  it('builds a read-only preview using account-scoped OLX credentials', async () => {
    const { service, adapter, create, getValidAccessToken, authenticatedHttpClient } = createService([
      remoteListing(),
    ]);

    const result = await service.preview({ workspaceId: 'workspace-1', marketplaceId: 'marketplace-1' });

    if (result.isErr()) throw result.error;
    const preview = result.value;
    expect(getValidAccessToken).toHaveBeenCalledWith('marketplace-1');
    expect(authenticatedHttpClient).toHaveBeenCalledWith('access-token');
    expect(create).toHaveBeenCalledWith('olx', expect.any(Object));
    expect(adapter.listOwnedListings).toHaveBeenCalledWith({ pageSize: undefined, statuses: undefined });
    expect(preview.readOnly).toBe(true);
    expect(preview.totals).toEqual({
      discovered: 1,
      new: 1,
      already_imported: 0,
      changed: 0,
      unsupported: 0,
      failed: 0,
    });
    expect(preview.items[0]).toMatchObject({
      status: 'new',
      externalListingId: 'olx-1',
      title: 'Remote camera',
      warnings: expect.arrayContaining(['unknown_cost_price', 'unknown_condition_requires_confirmation']),
    });
    expect(adapter.publish).not.toHaveBeenCalled();
    expect(adapter.updateListing).not.toHaveBeenCalled();
    expect(adapter.delist).not.toHaveBeenCalled();
  });

  it('marks already imported adverts by marketplace external id and reports mapping warnings', async () => {
    const existing = unwrap(
      Listing.create({
        id: 'listing-1',
        productId: 'product-1',
        marketplaceId: 'marketplace-1',
        marketplaceListingId: 'olx-1',
        price: money(100),
        status: 'live',
      }),
    );
    const { service } = createService(
      [remoteListing({ price: null, category: null, imageUrls: [] })],
      [existing],
    );

    const result = await service.preview({ workspaceId: 'workspace-1', marketplaceId: 'marketplace-1' });

    if (result.isErr()) throw result.error;
    expect(result.value.totals).toEqual({
      discovered: 1,
      new: 0,
      already_imported: 0,
      changed: 0,
      unsupported: 1,
      failed: 0,
    });
    expect(result.value.items[0].warnings).toEqual(expect.arrayContaining([
      'missing_price',
      'missing_category_mapping',
      'missing_photos',
      'missing_required_import_fields',
    ]));
  });

  it('imports eligible selected adverts locally without provider mutations and records provenance', async () => {
    const { service, productRepo, listingRepo, activityLog, adapter } = createService([remoteListing()]);

    const result = await service.import({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
      externalListingIds: ['olx-1'],
      actorId: 'user-1',
    });

    if (result.isErr()) throw result.error;
    expect(result.value).toMatchObject({ imported: 1, updated: 0, skipped: 0, failed: 0 });
    const products = await productRepo.findByWorkspace('workspace-1');
    expect(products).toHaveLength(1);
    expect(products[0].tags).toEqual(expect.arrayContaining(['imported:olx', 'cost-price:unknown']));
    const listings = await listingRepo.findByMarketplace('marketplace-1');
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({ marketplaceListingId: 'olx-1', externalUrl: 'https://www.olx.pl/d/oferta/olx-1' });
    expect(listings[0].views).toBe(7);
    expect(activityLog.entries[0]).toMatchObject({
      action: 'olx_import_adopted',
      actorType: 'user',
      actorId: 'user-1',
      metadata: expect.objectContaining({
        marketplace: 'olx',
        marketplaceAccountId: 'account-1',
        externalListingId: 'olx-1',
        readOnlyProviderOperation: true,
      }),
    });
    expect(adapter.publish).not.toHaveBeenCalled();
    expect(adapter.updateListing).not.toHaveBeenCalled();
    expect(adapter.delist).not.toHaveBeenCalled();
  });
});
