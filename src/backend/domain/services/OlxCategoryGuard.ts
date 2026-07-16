import type { MarketplaceCategoryMetadata } from '../../../shared/types';

export type OlxCategoryGuardReason =
  | 'category_missing'
  | 'category_not_leaf'
  | 'taxonomy_unverified'
  | 'taxonomy_stale'
  | 'category_low_confidence'
  | 'semantic_mismatch';

export interface OlxCategoryGuardResult {
  allowed: boolean;
  requiresReview: boolean;
  reason?: OlxCategoryGuardReason;
  message?: string;
}

const PROJECTOR_TERMS = ['projector', 'projektor', 'beamer'];
const HEADPHONE_TERMS = ['headphone', 'headphones', 'słuchawki', 'sluchawki', 'earbuds', 'airpods'];

function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

/**
 * Fail-closed OLX leaf-category validation. Category identity comes from provider
 * taxonomy metadata; the lexical check only rejects obvious contradictions and
 * never chooses a category ID itself.
 */
export function evaluateOlxCategory(
  product: { name: string; description: string; category: string },
  category: MarketplaceCategoryMetadata | null,
  now: Date = new Date(),
): OlxCategoryGuardResult {
  if (!category?.providerCategoryId?.trim() || category.path.length === 0) {
    return { allowed: false, requiresReview: true, reason: 'category_missing', message: 'Select an exact OLX leaf category before publishing' };
  }
  if (!category.isLeaf) {
    return { allowed: false, requiresReview: true, reason: 'category_not_leaf', message: 'The selected OLX category is not a leaf category' };
  }
  const verifiedAt = new Date(category.taxonomyVerifiedAt).getTime();
  const staleAt = new Date(category.taxonomyStaleAt).getTime();
  if (Number.isNaN(verifiedAt) || Number.isNaN(staleAt) || staleAt <= verifiedAt) {
    return { allowed: false, requiresReview: true, reason: 'taxonomy_unverified', message: 'OLX taxonomy verification time is missing or invalid' };
  }
  if (now.getTime() >= staleAt) {
    return { allowed: false, requiresReview: true, reason: 'taxonomy_stale', message: 'The selected OLX taxonomy metadata is stale; refresh it before publishing' };
  }
  if (!Number.isFinite(category.confidence) || category.confidence < 0.8 || category.confidence > 1) {
    return { allowed: false, requiresReview: true, reason: 'category_low_confidence', message: 'The OLX category match has low confidence and requires user confirmation' };
  }

  const productText = `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase('pl');
  const categoryText = category.path.join(' ').toLocaleLowerCase('pl');
  const projectorProduct = containsAny(productText, PROJECTOR_TERMS);
  const headphoneProduct = containsAny(productText, HEADPHONE_TERMS);
  const projectorCategory = containsAny(categoryText, PROJECTOR_TERMS);
  const headphoneCategory = containsAny(categoryText, HEADPHONE_TERMS);
  if ((projectorProduct && headphoneCategory) || (headphoneProduct && projectorCategory)) {
    return {
      allowed: false,
      requiresReview: true,
      reason: 'semantic_mismatch',
      message: `Product identity contradicts OLX category ${category.path.join(' → ')}`,
    };
  }
  return { allowed: true, requiresReview: false };
}
