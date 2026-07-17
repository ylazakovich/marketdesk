import type { HermesEvent, Listing, Marketplace } from '@shared/types';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildPublishListingInput,
  categoryConflictEvidenceLines,
  mainPreviewImageSx,
  PublishPreviewReview,
  remoteMarketplaceChipColor,
  remoteMarketplacePresentation,
  selectPrimaryListing,
  selectProductRecommendations,
} from './ListingDetailsPage';
import type { PublishListingPreview } from '../state/api/dto';
import { formatDateTime } from '../utils/formatters';

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
  it('exposes current and candidate listing evidence for a category conflict', () => {
    const source = {
      marketplaceKey: 'olx' as const, marketplaceId: 'marketplace-1',
      providerCategoryId: '100', name: 'Projectors', path: ['Electronics', 'Projectors'],
      taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z', syncedAt: '2026-07-15T01:00:00.000Z',
    };
    expect(categoryConflictEvidenceLines({
      status: 'conflict', detectedAt: '2026-07-15T02:00:00.000Z',
      currentSources: [{ ...source, listingId: 'listing-current' }],
      candidates: [{ ...source, listingId: 'listing-candidate', providerCategoryId: '200', path: ['Electronics', 'Audio'] }],
    })).toEqual([
      `Current · listing listing-current · Electronics › Projectors · ID 100 · Taxonomy verified ${formatDateTime(source.taxonomyVerifiedAt)} · Synced ${formatDateTime(source.syncedAt)}`,
      `Candidate · listing listing-candidate · Electronics › Audio · ID 200 · Taxonomy verified ${formatDateTime(source.taxonomyVerifiedAt)} · Synced ${formatDateTime(source.syncedAt)}`,
    ]);
  });

  it.each([
    ['low-confidence', 'Category confidence 0.42 is below the required threshold'],
    ['stale', 'OLX taxonomy verification is stale'],
  ])('keeps exact category identity and the %s blocker visible in publish review', (_case, reason) => {
    const preview: PublishListingPreview = {
      dryRun: true,
      canPublish: false,
      quotaOverrideEligibility: { eligible: false, reason: null },
      listingId: 'listing-projector',
      status: 'draft',
      marketplaceKey: 'olx',
      payload: {
        productName: 'AOPEN QH11 projector',
        description: 'HD projector',
        price: 299,
        currency: 'PLN',
        category: 'electronics',
        marketplaceCategory: null,
        condition: 'used',
        imageCount: 2,
      },
      marketplaceCategory: {
        providerCategoryId: 'projectors-91',
        name: 'Projectors',
        path: ['Electronics', 'TV and video', 'Projectors'],
        source: 'provider_taxonomy',
        confidence: 0.42,
        isLeaf: true,
        taxonomyVerifiedAt: '2026-06-01T00:00:00.000Z',
        taxonomyStaleAt: '2026-06-02T00:00:00.000Z',
      },
      warnings: [reason],
    };

    const html = renderToStaticMarkup(<PublishPreviewReview preview={preview} />);

    expect(html).toContain('projectors-91');
    expect(html).toContain('Electronics → TV and video → Projectors');
    expect(html).toContain(reason);
    expect(html).toContain('Publication is blocked');
  });

  it('builds a single-operation quota override only after explicit valid confirmation', () => {
    const preview: PublishListingPreview = {
      dryRun: true,
      canPublish: false,
      quotaOverrideEligibility: { eligible: true, reason: 'quota_unknown' },
      listingId: 'listing-frezarka',
      status: 'expired',
      marketplaceKey: 'olx',
      payload: null,
      marketplaceCategory: null,
      warnings: ['OLX quota blocks publication: quota_unknown'],
    };

    expect(buildPublishListingInput('listing-frezarka', preview, false, 'Possible fee accepted')).toBeNull();
    expect(buildPublishListingInput('listing-frezarka', preview, true, 'short')).toBeNull();
    expect(buildPublishListingInput('listing-frezarka', preview, true, 'x'.repeat(501))).toBeNull();
    expect(buildPublishListingInput('listing-frezarka', preview, true, '  Possible fee accepted  ')).toEqual({
      id: 'listing-frezarka',
      quotaOverride: { confirmed: true, reason: 'Possible fee accepted' },
    });
  });

  it('never builds an override for non-quota blockers and leaves normal publish unchanged', () => {
    const blocked: PublishListingPreview = {
      dryRun: true,
      canPublish: false,
      quotaOverrideEligibility: { eligible: false, reason: 'quota_unknown' },
      listingId: 'listing-projector',
      status: 'draft',
      marketplaceKey: 'olx',
      payload: null,
      marketplaceCategory: null,
      warnings: ['OLX taxonomy verification is stale', 'OLX quota blocks publication: quota_unknown'],
    };

    expect(buildPublishListingInput('listing-projector', blocked, true, 'Accept possible provider fee')).toBeNull();
    expect(buildPublishListingInput(
      'listing-projector',
      { ...blocked, canPublish: true, quotaOverrideEligibility: { eligible: false, reason: null }, warnings: [] },
      true,
      'This must not be sent',
    )).toEqual({ id: 'listing-projector' });
  });

  it('presents eligible quota blocks as explicit fee-risk confirmation rather than a bypass', () => {
    const preview: PublishListingPreview = {
      dryRun: true,
      canPublish: false,
      quotaOverrideEligibility: { eligible: true, reason: 'quota_unknown' },
      listingId: 'listing-frezarka',
      status: 'expired',
      marketplaceKey: 'olx',
      payload: null,
      marketplaceCategory: null,
      warnings: ['OLX quota blocks publication: quota_unknown'],
    };

    const html = renderToStaticMarkup(<PublishPreviewReview preview={preview} />);
    expect(html).toContain('operation-scoped fee-risk confirmation');
    expect(html).toContain('Quota confirmation required');
  });

  it('centers the full-size preview without stretching it across both axes', () => {
    expect(mainPreviewImageSx).toMatchObject({
      display: 'block',
      width: 'auto',
      height: 'auto',
      maxWidth: '100%',
      maxHeight: '100%',
      objectFit: 'contain',
      margin: 'auto',
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
