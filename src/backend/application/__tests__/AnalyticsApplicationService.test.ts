import { AnalyticsApplicationService } from '../services/AnalyticsApplicationService';
import {
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../domain/testkit/support';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import { Marketplace } from '../../domain/entities/Marketplace';

function setup() {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const service = new AnalyticsApplicationService(productRepo, listingRepo, marketplaceRepo);
  return { service, productRepo, listingRepo, marketplaceRepo };
}

describe('AnalyticsApplicationService', () => {
  it('returns human-readable listing identity metadata', async () => {
    const { service, productRepo, listingRepo, marketplaceRepo } = setup();
    const product = unwrap(
      Product.create({
        id: 'product-1',
        workspaceId: 'ws-1',
        sku: 'AIRPODS4-PL-001',
        name: 'AirPods 4',
        description: 'AirPods in good condition with all required details.',
        costPrice: money(649),
        sellingPrice: money(799),
        condition: 'good',
        category: 'audio',
      }),
    );
    productRepo.items.set(product.id, product);
    const marketplace = unwrap(
      Marketplace.create({
        id: 'marketplace-olx',
        workspaceId: 'ws-1',
        key: 'olx',
        name: 'OLX',
        connected: true,
      }),
    );
    marketplaceRepo.items.set(marketplace.id, marketplace);
    const listing = unwrap(
      Listing.create({
        id: 'listing-1',
        productId: product.id,
        marketplaceId: marketplace.id,
        marketplaceListingId: 'olx-123',
        price: money(799),
        status: 'live',
        views: 42,
      }),
    );
    listingRepo.items.set(listing.id, listing);
    listingRepo.listingWorkspaces.set(listing.id, 'ws-1');

    const rows = await service.getListingPerformance('ws-1');

    expect(rows).toEqual([
      expect.objectContaining({
        listingId: 'listing-1',
        productId: 'product-1',
        productName: 'AirPods 4',
        productSku: 'AIRPODS4-PL-001',
        marketplaceId: 'marketplace-olx',
        marketplaceName: 'OLX',
        marketplaceListingId: 'olx-123',
      }),
    ]);
  });
});
