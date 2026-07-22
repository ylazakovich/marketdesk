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
import type {
  AnalyticsEventRecord,
  IAnalyticsEventRepository,
} from '../ports/IAnalyticsEventRepository';

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

  it('uses persisted events for canonical current/previous metrics and marketplace-filtered reports', async () => {
    const { productRepo, listingRepo, marketplaceRepo } = setup();
    const product = unwrap(Product.create({
      id: 'product-1', workspaceId: 'ws-1', sku: 'SKU-1', name: 'Camera',
      description: 'Camera with complete details and accessories', costPrice: money(50),
      sellingPrice: money(120), condition: 'good', category: 'cameras',
    }));
    const marketplace = unwrap(Marketplace.create({
      id: 'marketplace-1', workspaceId: 'ws-1', key: 'olx', name: 'OLX', connected: true,
    }));
    const listing = unwrap(Listing.create({
      id: 'listing-1', productId: product.id, marketplaceId: marketplace.id,
      price: money(120), status: 'live',
    }));
    productRepo.items.set(product.id, product);
    marketplaceRepo.items.set(marketplace.id, marketplace);
    listingRepo.items.set(listing.id, listing);
    listingRepo.listingWorkspaces.set(listing.id, 'ws-1');
    const event = (
      id: string, eventType: AnalyticsEventRecord['eventType'], occurredAt: string,
      quantity: number, amount: number | null = null, costAtSale: number | null = null,
      marketplaceId = marketplace.id,
    ): AnalyticsEventRecord => ({
      id, workspaceId: 'ws-1', listingId: listing.id, marketplaceId,
      eventType, occurredAt: new Date(occurredAt), quantity, amount, costAtSale,
    });
    const events = [
      event('current-views', 'view', '2026-07-05T10:00:00Z', 100),
      event('current-sale', 'sale', '2026-07-06T10:00:00Z', 2, 200, 50),
      event('previous-views', 'view', '2026-06-25T10:00:00Z', 50),
      event('previous-sale', 'sale', '2026-06-26T10:00:00Z', 1, 100, 40),
      event('other-market', 'sale', '2026-07-06T12:00:00Z', 1, 999, 1, 'marketplace-2'),
    ];
    const analyticsEvents: IAnalyticsEventRepository = {
      async findByRange(query) {
        return events.filter((item) => item.workspaceId === query.workspaceId
          && item.occurredAt >= query.from && item.occurredAt < query.to
          && (!query.marketplaceId || item.marketplaceId === query.marketplaceId));
      },
    };
    const service = new AnalyticsApplicationService(productRepo, listingRepo, marketplaceRepo, analyticsEvents);
    const range = {
      from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-07-11T00:00:00Z'),
      marketplaceId: marketplace.id, interval: 'day' as const,
    };

    const overview = await service.getDashboardMetrics('ws-1', range);
    expect(overview).toMatchObject({
      revenue: 200, profit: 100, totalViews: 100, sales: 2, conversion: 2,
      previous: { revenue: 100, profit: 60, totalViews: 50, sales: 1, conversion: 2 },
    });
    const revenue = await service.getRevenue('ws-1', range);
    expect(revenue.currency).toBe('PLN');
    expect(revenue.series).toEqual(expect.arrayContaining([
      expect.objectContaining({ revenue: 200, profit: 100 }),
    ]));
    const performance = await service.getListingPerformance('ws-1', range);
    expect(performance[0]).toMatchObject({
      listingId: listing.id, revenue: 200, profit: 100, views: 100, sales: 2, conversion: 2,
    });
  });
});
