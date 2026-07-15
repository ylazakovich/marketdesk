import { MarketplaceImportService } from '../MarketplaceImportService';
import { Marketplace } from '../../../domain/entities/Marketplace';
import { Listing } from '../../../domain/entities/Listing';
import type { IMarketplaceAdapter, ImportedMarketplaceListing } from '../../../domain/services/MarketplaceAdapter';
import type { MarketplaceAccountRecord } from '../MarketplaceOAuthService';
import { unwrap, money } from '../../../domain/testkit/support';

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
    description: 'Existing OLX advert',
    price: 100,
    currency: 'PLN',
    status: 'live',
    remoteStatus: 'active',
    category: 'Electronics',
    imageUrls: ['https://img/1.jpg'],
    remoteUpdatedAt: new Date('2026-07-14T00:00:00.000Z'),
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
    { findByIdForWorkspace: jest.fn(async () => marketplace) } as any,
    { findByMarketplace: jest.fn(async () => existing) } as any,
    { findByMarketplaceId: jest.fn(async () => connectedAccount) } as any,
    { create },
    { getValidAccessToken },
    authenticatedHttpClient,
  );
  return { service, adapter, create, getValidAccessToken, authenticatedHttpClient };
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
    expect(preview.totals).toEqual({ discovered: 1, new: 1, already_imported: 0, unsupported: 0 });
    expect(preview.items[0]).toMatchObject({
      status: 'new',
      externalListingId: 'olx-1',
      title: 'Remote camera',
      warnings: [],
    });
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
    expect(result.value.totals).toEqual({ discovered: 1, new: 0, already_imported: 1, unsupported: 0 });
    expect(result.value.items[0].warnings).toEqual([
      'missing_price',
      'missing_category_mapping',
      'missing_photos',
    ]);
  });
});
