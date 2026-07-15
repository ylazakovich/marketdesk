import { presentListing } from './presenters';
import { Listing } from '../../domain/entities/Listing';
import { unwrap, money } from '../../domain/testkit/support';

function listingWithExternalUrl(url: string | null) {
  return unwrap(
    Listing.create({
      id: 'listing-1',
      productId: 'product-1',
      marketplaceId: 'marketplace-1',
      marketplaceListingId: 'olx-1',
      externalUrl: url,
      price: money(50),
      status: 'live',
      publishedAt: new Date('2026-07-15T00:00:00.000Z'),
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    }),
  );
}

describe('presentListing', () => {
  it('returns canonical HTTPS OLX external URLs', () => {
    const view = presentListing(listingWithExternalUrl('https://www.olx.pl/d/oferta/camera-123'));

    expect(view.externalUrl).toBe('https://www.olx.pl/d/oferta/camera-123');
  });

  it.each([
    'http://www.olx.pl/d/oferta/camera-123',
    'https://evil.example/phishing',
    'not-a-url',
  ])('omits unsafe external URL %s', (url: string) => {
    const view = presentListing(listingWithExternalUrl(url));

    expect(view.externalUrl).toBeUndefined();
  });
});
