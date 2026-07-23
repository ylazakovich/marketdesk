import { Listing } from '../../entities/Listing';
import { Marketplace } from '../../entities/Marketplace';
import { Product } from '../../entities/Product';
import { ListingService } from '../ListingService';
import {
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  RecordingEventPublisher,
  money,
  unwrap,
} from '../../testkit/support';
import type { MarketplaceCategoryMetadata } from '../../../../shared/types';

const exactCategory: MarketplaceCategoryMetadata = {
  providerCategoryId: '5091',
  name: 'Akcesoria samochodowe',
  path: ['Motoryzacja', 'Akcesoria samochodowe'],
  source: 'provider_taxonomy',
  confidence: 1,
  isLeaf: true,
  taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
  taxonomyStaleAt: '2026-08-15T00:00:00.000Z',
};

describe('ListingService', () => {
  it('includes the persisted marketplace category in the publish state current input', async () => {
    const productRepo = new InMemoryProductRepository();
    const listingRepo = new InMemoryListingRepository();
    const marketplaceRepo = new InMemoryMarketplaceRepository();
    const service = new ListingService(
      listingRepo,
      productRepo,
      marketplaceRepo,
      new RecordingEventPublisher()
    );
    const product = unwrap(
      Product.create({
        id: 'product-1',
        workspaceId: 'workspace-1',
        sku: 'sku-1',
        name: 'Product title',
        description: 'Product description long enough for domain validation.',
        costPrice: null,
        sellingPrice: money(50),
        condition: 'good',
        category: 'electronics',
        status: 'active',
        images: ['https://example.test/photo.jpg'],
      })
    );
    const marketplace = unwrap(
      Marketplace.create({
        id: 'marketplace-1',
        workspaceId: 'workspace-1',
        key: 'olx',
        name: 'OLX',
        connected: true,
      })
    );
    const listing = unwrap(
      Listing.create({
        id: 'listing-1',
        productId: product.id,
        marketplaceId: marketplace.id,
        price: money(60),
        status: 'live',
        marketplaceListingId: '1085783130',
        externalUrl: 'https://www.olx.pl/d/oferta/1085783130',
        publishedAt: new Date('2026-07-10T00:00:00.000Z'),
        marketplaceCategory: exactCategory,
      })
    );
    productRepo.items.set(product.id, product);
    marketplaceRepo.items.set(marketplace.id, marketplace);
    listingRepo.items.set(listing.id, listing);

    await expect(service.getPublishState(listing.id)).resolves.toMatchObject({
      isPublished: true,
      externalListingId: '1085783130',
      currentInput: {
        productName: 'Product title',
        marketplaceCategory: exactCategory,
      },
    });
  });
});
