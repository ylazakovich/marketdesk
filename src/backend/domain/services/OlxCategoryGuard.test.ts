import { evaluateOlxCategory } from './OlxCategoryGuard';
import type { MarketplaceCategoryMetadata } from '../../../shared/types';

const now = new Date('2026-07-16T12:00:00.000Z');

function category(overrides: Partial<MarketplaceCategoryMetadata> = {}): MarketplaceCategoryMetadata {
  return {
    providerCategoryId: 'projectors-123',
    name: 'Projectors',
    path: ['Electronics', 'Video', 'Projectors'],
    source: 'provider_taxonomy',
    confidence: 0.98,
    isLeaf: true,
    taxonomyVerifiedAt: '2026-07-16T00:00:00.000Z',
    taxonomyStaleAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

const projector = {
  name: 'AOPEN QH11 projector',
  description: 'LED HD 720p HDMI projector in very good condition.',
  category: 'electronics',
};

describe('evaluateOlxCategory', () => {
  it('allows an exact, current leaf-category match', () => {
    expect(evaluateOlxCategory(projector, category(), now)).toEqual({
      allowed: true,
      requiresReview: false,
    });
  });

  it('blocks the projector-versus-wireless-headphones mismatch', () => {
    const result = evaluateOlxCategory(projector, category({
      providerCategoryId: 'headphones-456',
      name: 'Wireless headphones',
      path: ['Electronics', 'Audio equipment', 'Headphones', 'Wireless headphones'],
    }), now);

    expect(result).toMatchObject({ allowed: false, reason: 'semantic_mismatch' });
  });

  it.each([
    ['missing', null, 'category_missing'],
    ['unknown leaf', category({ isLeaf: false }), 'category_not_leaf'],
    ['invalid taxonomy dates', category({ taxonomyStaleAt: 'unknown' }), 'taxonomy_unverified'],
    ['stale taxonomy', category({ taxonomyStaleAt: now.toISOString() }), 'taxonomy_stale'],
  ] as const)('blocks %s category metadata', (_label, metadata, reason) => {
    expect(evaluateOlxCategory(projector, metadata, now)).toMatchObject({
      allowed: false,
      requiresReview: true,
      reason,
    });
  });
});
