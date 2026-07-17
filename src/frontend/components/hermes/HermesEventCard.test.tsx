import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  CategoryRecreationChangePayload,
  ProductCategoryConflictChangePayload,
} from '@shared/types';
import { CategoryRecreationReview, ProposedChangeDiff } from './HermesEventCard';

const change: CategoryRecreationChangePayload = {
  kind: 'category_recreation',
  listingId: 'listing-1085545830',
  currentCategory: {
    providerCategoryId: 'headphones-44',
    name: 'Wireless headphones',
    path: ['Electronics', 'Audio equipment', 'Headphones', 'Wireless headphones'],
    source: 'provider_taxonomy',
    confidence: 1,
    isLeaf: true,
    taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
    taxonomyStaleAt: '2026-07-16T00:00:00.000Z',
  },
  proposedCategory: {
    providerCategoryId: 'projectors-91',
    name: 'Projectors',
    path: ['Electronics', 'TV and video', 'Projectors'],
    source: 'provider_taxonomy',
    confidence: 0.94,
    isLeaf: true,
    taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
    taxonomyStaleAt: '2026-07-16T00:00:00.000Z',
  },
  operations: [
    {
      kind: 'delist',
      intentId: 'delist-intent-1',
      status: 'pending_review',
      providerSideEffectAllowed: false,
      quotaUnitsRestored: 0,
      availableActions: [
        { kind: 'approve', method: 'POST', href: '/hermes/category-correction-operations/delist-intent-1/approve', label: 'Review delist' },
      ],
    },
    {
      kind: 'recreate',
      intentId: 'recreate-intent-1',
      status: 'blocked_pending_quota_review',
      providerSideEffectAllowed: false,
      quotaGuardRequired: true,
      quota: {
        status: 'unknown',
        cycleStartedAt: '2026-07-15T00:00:00.000Z',
        cycleEndsAt: '2026-08-14T00:00:00.000Z',
        remaining: null,
        paidRisk: true,
        reason: 'OLX has not provided authoritative remaining quota.',
      },
    },
  ],
};

describe('CategoryRecreationReview', () => {
  it('renders exact current/proposed categories and separate durable operations without generic Apply', () => {
    const html = renderToStaticMarkup(<CategoryRecreationReview change={change} />);

    expect(html).toContain('headphones-44');
    expect(html).toContain('Electronics → Audio equipment → Headphones → Wireless headphones');
    expect(html).toContain('projectors-91');
    expect(html).toContain('Electronics → TV and video → Projectors');
    expect(html).toContain('Delist current advert');
    expect(html).toContain('Recreate advert');
    expect(html).toContain('pending review');
    expect(html).toContain('blocked pending quota review');
    expect(html).toContain('Review delist');
    expect(html).not.toContain('>Apply<');
  });

  it('states quota uncertainty, cycle, remaining state, paid risk, and deletion semantics honestly', () => {
    const html = renderToStaticMarkup(<CategoryRecreationReview change={change} />);

    expect(html).toContain('15 Jul 2026');
    expect(html).toContain('14 Aug 2026');
    expect(html).toContain('Unknown');
    expect(html).toContain('Paid placement risk');
    expect(html).toContain('does not restore');
    expect(html).toContain('OLX has not provided authoritative remaining quota.');
    expect(html).toContain('No durable recreate action is available');
  });
});

describe('product category conflict review', () => {
  it('renders the unchanged current category and every exact candidate source', () => {
    const conflict: ProductCategoryConflictChangePayload = {
      kind: 'product_category_conflict',
      productId: 'product-1',
      currentCategory: 'Electronics',
      candidates: [
        {
          marketplaceKey: 'olx', marketplaceId: 'marketplace-1', listingId: 'listing-1',
          providerCategoryId: 'projectors-91', name: 'Projectors',
          path: ['Electronics', 'TV and video', 'Projectors'],
          taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
          syncedAt: '2026-07-15T01:00:00.000Z',
        },
        {
          marketplaceKey: 'olx', marketplaceId: 'marketplace-1', listingId: 'listing-2',
          providerCategoryId: 'headphones-44', name: 'Wireless headphones',
          path: ['Electronics', 'Audio equipment', 'Wireless headphones'],
          taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
          syncedAt: '2026-07-15T01:00:00.000Z',
        },
      ],
    };

    const html = renderToStaticMarkup(<ProposedChangeDiff change={conflict} currency="PLN" />);

    expect(html).toContain('Current category: Electronics');
    expect(html).toContain('Electronics › TV and video › Projectors');
    expect(html).toContain('ID projectors-91');
    expect(html).toContain('Electronics › Audio equipment › Wireless headphones');
    expect(html).toContain('ID headphones-44');
  });
});
