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

  it('blocks a product/category semantic mismatch even when it is outside projector-headphone terms', () => {
    const result = evaluateOlxCategory({
      name: 'Vintage running sneakers',
      description: 'Used but in good condition',
      category: 'men\'s shoes',
    }, category({
      providerCategoryId: 'televisions-900',
      name: 'Televisions',
      path: ['Electronics', 'Audio and video', 'Televisions'],
    }), now);

    expect(result).toMatchObject({ allowed: false, reason: 'semantic_mismatch' });
  });

  it('does not use a generic taxonomy ancestor to match an electronic scale to televisions', () => {
    const result = evaluateOlxCategory({
      name: 'Electronic kitchen scale', description: 'Digital kitchen scale with LCD display', category: 'kitchen scales',
    }, category({
      providerCategoryId: 'televisions-901', name: 'Televisions',
      path: ['Electronics', 'Audio and video', 'Televisions'],
    }), now);
    expect(result).toMatchObject({ allowed: false, reason: 'semantic_mismatch' });
  });

  it('keeps valid semantic aliases usable without requiring literal word overlap', () => {
    const result = evaluateOlxCategory({
      name: 'Apple iPhone 15', description: 'Apple mobile phone in excellent condition', category: 'phones',
    }, category({
      providerCategoryId: 'smartfony-22', name: 'Smartfony',
      path: ['Elektronika', 'Telefony', 'Smartfony'],
    }), now);
    expect(result).toEqual({ allowed: true, requiresReview: false });
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
