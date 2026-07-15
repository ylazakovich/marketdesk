import type { HermesEvent, Listing, Marketplace } from '@shared/types';
import {
  mainPreviewImageSx,
  remoteMarketplaceChipColor,
  remoteMarketplacePresentation,
  selectPrimaryListing,
  selectProductRecommendations,
} from './ListingDetailsPage';

const listing: Listing = {
  id: 'listing-1',
  productId: 'product-1',
  marketplaceId: 'marketplace-1',
  marketplaceListingId: 'olx-123',
  externalUrl: 'https://www.olx.pl/d/oferta/olx-123',
  price: 399,
  status: 'live',
  remoteStatus: 'active',
  remoteStatusLabel: 'Active',
  isRemotePending: false,
  views: 3,
  watchers: 0,
  messages: 0,
  publishedAt: '2026-07-15T17:00:00.000Z',
  lastSyncAt: '2026-07-15T19:04:00.000Z',
  createdAt: '2026-07-15T16:00:00.000Z',
  updatedAt: '2026-07-15T19:04:00.000Z',
};

function event(
  id: string,
  productId: string | undefined,
  status: HermesEvent['status']
): HermesEvent {
  return {
    id,
    workspaceId: 'workspace-1',
    productId,
    type: 'suggested_better_title',
    severity: 'info',
    status,
    title: `Suggestion ${id}`,
    proposedChange: { kind: 'title', field: 'title', from: 'Old', to: 'New' },
    createdAt: '2026-07-15T18:00:00.000Z',
  };
}

describe('ListingDetailsPage presentation', () => {
  it('keeps the full-size preview intrinsically sized and centered', () => {
    expect(mainPreviewImageSx).toMatchObject({
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      objectPosition: 'center',
    });
  });

  it('uses non-success colors for failed and ended remote states', () => {
    expect(remoteMarketplaceChipColor({ ...listing, remoteStatus: 'active' })).toBe('success');
    expect(remoteMarketplaceChipColor({ ...listing, remoteStatus: 'rejected' })).toBe('error');
    expect(remoteMarketplaceChipColor({ ...listing, remoteStatus: 'expired' })).toBe('default');
    expect(remoteMarketplaceChipColor({ ...listing, remoteStatus: 'moderation' })).toBe('warning');
  });

  it('prefers the OLX listing when a product is listed on several marketplaces', () => {
    const otherListing = { ...listing, id: 'listing-other', marketplaceId: 'marketplace-other' };
    const marketplaces = [
      { id: 'marketplace-other', key: 'ebay' },
      { id: 'marketplace-1', key: 'olx' },
    ] as Marketplace[];

    expect(selectPrimaryListing([otherListing, listing], marketplaces)?.id).toBe('listing-1');
  });

  it('explains the provider status without repeating an unlabeled Active value', () => {
    expect(remoteMarketplacePresentation(listing, 'OLX')).toEqual(
      expect.objectContaining({
        title: 'OLX listing',
        status: 'Active on OLX',
        explanation:
          'Current listing status reported by OLX. This is separate from the product status in MarketDesk.',
        externalUrl: listing.externalUrl,
      })
    );
  });

  it('keeps pending and not-yet-synced provider states internally consistent', () => {
    expect(
      remoteMarketplacePresentation(
        { ...listing, remoteStatusLabel: undefined, isRemotePending: true },
        'OLX',
      ),
    ).toMatchObject({
      status: 'Pending on OLX',
      explanation:
        'OLX is still moderating or activating this listing. Metrics may be unavailable until it becomes active.',
    });

    expect(
      remoteMarketplacePresentation(
        { ...listing, remoteStatusLabel: undefined, isRemotePending: false },
        'OLX',
      ),
    ).toMatchObject({
      status: 'Not synced with OLX',
      explanation: 'OLX has not reported a listing status yet.',
    });
  });

  it('shows only pending Hermes recommendations for the current product', () => {
    const events = [
      event('current', 'product-1', 'pending_review'),
      event('other', 'product-2', 'pending_review'),
      event('resolved', 'product-1', 'applied'),
      event('workspace-only', undefined, 'pending_review'),
    ];

    expect(selectProductRecommendations(events, 'product-1').map(({ id }) => id)).toEqual([
      'current',
    ]);
  });
});
