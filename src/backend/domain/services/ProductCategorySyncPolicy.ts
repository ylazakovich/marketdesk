import type { MarketplaceCategoryMetadata, MarketplaceKey } from '../../../shared/types';
import type { Product } from '../entities/Product';
import { evaluateOlxCategory } from './OlxCategoryGuard';

export type ProductCategoryPolicyDecision =
  | { kind: 'candidate'; category: string }
  | { kind: 'conflict'; reason: string }
  | { kind: 'ignore'; reason: string };

/**
 * Marketplace-specific Product category mapping policy.
 *
 * OLX: a fresh, provider-taxonomy-backed exact leaf maps to its normalized leaf
 * display name. The exact provider id and full path are retained separately as
 * provenance by the reconciliation service. Untrusted/missing metadata is a
 * no-op; a trusted but semantically incompatible leaf is surfaced for review.
 */
export function evaluateProductCategoryCandidate(
  product: Product,
  marketplaceKey: MarketplaceKey,
  metadata: MarketplaceCategoryMetadata | null,
  now: Date = new Date(),
): ProductCategoryPolicyDecision {
  if (marketplaceKey !== 'olx') {
    return { kind: 'ignore', reason: `No product category mapping policy for ${marketplaceKey}` };
  }
  if (!metadata) return { kind: 'ignore', reason: 'Marketplace category metadata is missing' };

  const evaluation = evaluateOlxCategory(
    { name: product.name, description: product.description, category: '' },
    metadata,
    now,
  );
  if (!evaluation.allowed) {
    return evaluation.reason === 'semantic_mismatch'
      ? { kind: 'conflict', reason: evaluation.message ?? 'Marketplace category conflicts with the product' }
      : { kind: 'ignore', reason: evaluation.message ?? 'Marketplace category is not trusted' };
  }

  const category = metadata.name.trim();
  if (!category || category.length > 100) {
    return { kind: 'ignore', reason: 'Marketplace leaf name is empty or exceeds Product category limits' };
  }

  return { kind: 'candidate', category };
}
