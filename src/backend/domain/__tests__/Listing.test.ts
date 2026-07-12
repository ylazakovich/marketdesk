import { Product } from '../entities/Product';
import { Marketplace } from '../entities/Marketplace';
import { Listing } from '../entities/Listing';
import { unwrap, money } from '../testkit/support';

function makeProduct(sold = false): Product {
  const product = unwrap(
    Product.create({
      id: 'p1',
      workspaceId: 'w1',
      sku: 'SKU-1',
      name: 'Widget',
      description: 'A perfectly reasonable description over twenty chars.',
      costPrice: money(50),
      sellingPrice: money(80),
      condition: 'new',
      category: 'electronics',
    }),
  );
  if (sold) {
    unwrap(product.activate());
    unwrap(product.markSold());
  }
  return product;
}

function makeMarketplace(connected: boolean): Marketplace {
  return unwrap(
    Marketplace.create({
      id: 'm1',
      workspaceId: 'w1',
      key: 'olx',
      name: 'OLX',
      connected,
    }),
  );
}

function makeListing(): Listing {
  return unwrap(
    Listing.create({ id: 'l1', productId: 'p1', marketplaceId: 'm1', price: money(80) }),
  );
}

describe('Listing publish rules', () => {
  it('publishes when marketplace connected and product not sold', () => {
    const listing = makeListing();
    const result = listing.publish(makeProduct(false), makeMarketplace(true), 'ext-1');
    expect(result.isOk()).toBe(true);
    expect(listing.status).toBe('live');
    expect(listing.marketplaceListingId).toBe('ext-1');
  });

  it('refuses to publish to a disconnected marketplace', () => {
    const listing = makeListing();
    const result = listing.publish(makeProduct(false), makeMarketplace(false), 'ext-1');
    expect(result.isErr()).toBe(true);
  });

  it('refuses to publish a sold product', () => {
    const listing = makeListing();
    const result = listing.publish(makeProduct(true), makeMarketplace(true), 'ext-1');
    expect(result.isErr()).toBe(true);
  });

  it('requires an external listing id', () => {
    const listing = makeListing();
    const result = listing.publish(makeProduct(false), makeMarketplace(true), '');
    expect(result.isErr()).toBe(true);
  });
});

describe('Listing lifecycle', () => {
  it('detects expiry from a past expiresAt', () => {
    const listing = unwrap(
      Listing.create({
        id: 'l1',
        productId: 'p1',
        marketplaceId: 'm1',
        price: money(80),
        status: 'live',
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    expect(listing.isExpired()).toBe(true);
  });

  it('expires a live listing and relists it', () => {
    const listing = makeListing();
    unwrap(listing.publish(makeProduct(false), makeMarketplace(true), 'ext-1'));
    expect(listing.expire().isOk()).toBe(true);
    expect(listing.status).toBe('expired');
    expect(listing.relist().isOk()).toBe(true);
    expect(listing.status).toBe('live');
  });
});
