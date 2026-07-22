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
const MAX_TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_SEMANTIC_TERM_LENGTH = 3;
const STOP_WORDS = new Set([
  'and',
  'or',
  'with',
  'without',
  'for',
  'in',
  'on',
  'from',
  'to',
  'the',
  'a',
  'an',
  'of',
  'at',
  'new',
  'used',
  'very',
  'good',
  'great',
  'excellent',
  'condition',
  'light',
  'ultra',
]);

export function parseMarketplaceCategoryMetadata(value: unknown): MarketplaceCategoryMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MarketplaceCategoryMetadata>;
  if (
    typeof candidate.providerCategoryId !== 'string' || !candidate.providerCategoryId.trim()
    || typeof candidate.name !== 'string' || !candidate.name.trim()
    || !Array.isArray(candidate.path) || candidate.path.length === 0
    || candidate.path.some((part) => typeof part !== 'string' || !part.trim())
    || !['provider_taxonomy', 'remote_import', 'user_confirmed'].includes(candidate.source ?? '')
    || typeof candidate.confidence !== 'number'
    || typeof candidate.isLeaf !== 'boolean'
    || typeof candidate.taxonomyVerifiedAt !== 'string'
    || typeof candidate.taxonomyStaleAt !== 'string'
  ) return null;
  return {
    providerCategoryId: candidate.providerCategoryId.trim(),
    name: candidate.name.trim(),
    path: candidate.path.map((part) => part.trim()),
    source: candidate.source as MarketplaceCategoryMetadata['source'],
    confidence: candidate.confidence,
    isLeaf: candidate.isLeaf,
    taxonomyVerifiedAt: candidate.taxonomyVerifiedAt,
    taxonomyStaleAt: candidate.taxonomyStaleAt,
  };
}

function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function normalizeToken(token: string): string {
  return token
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl')
    .trim();
}

function extractTerms(value: string): string[] {
  const terms = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl')
    .match(/[\p{L}\p{N}]+/gu) ?? [];

  const output = new Set<string>();
  for (const rawTerm of terms) {
    const term = normalizeToken(rawTerm);
    if (term.length < MIN_SEMANTIC_TERM_LENGTH || STOP_WORDS.has(term)) {
      continue;
    }
    output.add(term);
    if (term.endsWith('es') && term.length > MIN_SEMANTIC_TERM_LENGTH + 2) {
      output.add(term.slice(0, -2));
    }
    if (term.endsWith('s') && term.length > MIN_SEMANTIC_TERM_LENGTH + 1) {
      output.add(term.slice(0, -1));
    }
  }

  return [...output];
}

function hasSemanticOverlap(productText: string, categoryText: string): boolean {
  const productTerms = extractTerms(productText);
  const categoryTerms = extractTerms(categoryText);
  if (!productTerms.length || !categoryTerms.length) {
    return true;
  }

  const categorySet = new Set(categoryTerms);
  return productTerms.some((productTerm) => {
    if (categorySet.has(productTerm)) {
      return true;
    }
    return [...categorySet].some((categoryTerm) => categoryTerm.includes(productTerm) || productTerm.includes(categoryTerm));
  });
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
  category = parseMarketplaceCategoryMetadata(category);
  if (!category) {
    return { allowed: false, requiresReview: true, reason: 'category_missing', message: 'Select an exact OLX leaf category before publishing' };
  }
  if (category.source !== 'provider_taxonomy') {
    return { allowed: false, requiresReview: true, reason: 'taxonomy_unverified', message: 'OLX category must be verified by the server against provider taxonomy' };
  }
  const normalizedName = category.name.trim().toLocaleLowerCase('pl');
  const normalizedLeaf = category.path[category.path.length - 1]?.trim().toLocaleLowerCase('pl');
  if (!normalizedLeaf || normalizedLeaf !== normalizedName) {
    return { allowed: false, requiresReview: true, reason: 'taxonomy_unverified', message: 'OLX category name does not match its taxonomy path' };
  }
  if (!category.isLeaf) {
    return { allowed: false, requiresReview: true, reason: 'category_not_leaf', message: 'The selected OLX category is not a leaf category' };
  }
  const verifiedAt = new Date(category.taxonomyVerifiedAt).getTime();
  const staleAt = new Date(category.taxonomyStaleAt).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || Number.isNaN(verifiedAt) || Number.isNaN(staleAt)
    || verifiedAt > nowMs || staleAt <= verifiedAt || staleAt - verifiedAt > MAX_TAXONOMY_TTL_MS) {
    return { allowed: false, requiresReview: true, reason: 'taxonomy_unverified', message: 'OLX taxonomy verification time is missing or invalid' };
  }
  if (nowMs >= staleAt) {
    return { allowed: false, requiresReview: true, reason: 'taxonomy_stale', message: 'The selected OLX taxonomy metadata is stale; refresh it before publishing' };
  }
  if (!Number.isFinite(category.confidence) || category.confidence < 0.8 || category.confidence > 1) {
    return { allowed: false, requiresReview: true, reason: 'category_low_confidence', message: 'The OLX category match has low confidence and requires user confirmation' };
  }

  const productText = `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase('pl');
  const categoryText = `${category.name} ${category.path.join(' ')}`.toLocaleLowerCase('pl');
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

  if (!hasSemanticOverlap(productText, categoryText)) {
    return {
      allowed: false,
      requiresReview: true,
      reason: 'semantic_mismatch',
      message: `Product identity contradicts OLX category ${category.path.join(' → ')}`,
    };
  }

  return { allowed: true, requiresReview: false };
}
