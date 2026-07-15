import { ListingApplicationService } from '../services/ListingApplicationService';
import {
  InMemoryListingRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../domain/testkit/support';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import type { PublishListingUseCase } from '../usecases/PublishListingUseCase';
import type { SyncMarketplaceUseCase } from '../usecases/SyncMarketplaceUseCase';

function setup() {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const service = new ListingApplicationService(
    listingRepo,
    {} as PublishListingUseCase,
    {} as SyncMarketplaceUseCase,
    productRepo,
  );
  return { service, productRepo, listingRepo };
}

describe('ListingApplicationService', () => {
  it('enriches product-detail listing rows with product title and SKU', async () => {
    const { service, productRepo, listingRepo } = setup();
    const product = unwrap(
      Product.create({
        id: 'product-1',
        workspaceId: 'ws-1',
        sku: 'AIRPODS4-PL-001',
        name: 'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan',
        description: 'AirPods in good condition with all required details.',
        costPrice: money(250),
        sellingPrice: money(399),
        condition: 'good',
        category: 'audio',
      }),
    );
    productRepo.items.set(product.id, product);
    for (const status of ['draft', 'live'] as const) {
      const listing = unwrap(
        Listing.create({
          id: `listing-${status}`,
          productId: product.id,
          marketplaceId: `marketplace-${status}`,
          marketplaceListingId: status === 'live' ? '1085426829' : undefined,
          price: money(399),
          status,
        }),
      );
      listingRepo.items.set(listing.id, listing);
      listingRepo.listingWorkspaces.set(listing.id, 'ws-1');
    }

    const rows = await service.listByProduct('product-1', 'ws-1');

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'listing-draft',
          status: 'draft',
          productName: 'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan',
          productSku: 'AIRPODS4-PL-001',
        }),
        expect.objectContaining({
          id: 'listing-live',
          status: 'live',
          productName: 'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan',
          productSku: 'AIRPODS4-PL-001',
        }),
      ]),
    );
  });
  it('enriches workspace listing rows with product title and SKU', async () => {
    const { service, productRepo, listingRepo } = setup();
    const product = unwrap(
      Product.create({
        id: 'product-1',
        workspaceId: 'ws-1',
        sku: 'AIRPODS4-PL-001',
        name: 'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan',
        description: 'AirPods in good condition with all required details.',
        costPrice: money(250),
        sellingPrice: money(399),
        condition: 'good',
        category: 'audio',
      }),
    );
    productRepo.items.set(product.id, product);
    const listing = unwrap(
      Listing.create({
        id: 'listing-1',
        productId: product.id,
        marketplaceId: 'marketplace-olx',
        marketplaceListingId: '1085426829',
        price: money(399),
        status: 'live',
      }),
    );
    listingRepo.items.set(listing.id, listing);
    listingRepo.listingWorkspaces.set(listing.id, 'ws-1');

    const page = await service.listByWorkspace('ws-1');

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'listing-1',
        productId: 'product-1',
        productName: 'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan',
        productSku: 'AIRPODS4-PL-001',
      }),
    ]);
  });

  it('only loads product identities for listings on the requested page', async () => {
    const { service, productRepo, listingRepo } = setup();
    for (const id of ['product-1', 'product-2']) {
      const product = unwrap(
        Product.create({
          id,
          workspaceId: 'ws-1',
          sku: `${id}-SKU`,
          name: `${id} name`,
          description: 'A product with all required details.',
          costPrice: money(10),
          sellingPrice: money(20),
          condition: 'good',
          category: 'audio',
        }),
      );
      productRepo.items.set(product.id, product);
      const listing = unwrap(
        Listing.create({
          id: `listing-${id}`,
          productId: id,
          marketplaceId: 'marketplace-olx',
          price: money(20),
          status: 'live',
        }),
      );
      listingRepo.items.set(listing.id, listing);
      listingRepo.listingWorkspaces.set(listing.id, 'ws-1');
    }
    const findSpy = jest.spyOn(productRepo, 'findByIdForWorkspace');

    const page = await service.listByWorkspace('ws-1', 1, 0);

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith(page.items[0].productId, 'ws-1');
  });
});
