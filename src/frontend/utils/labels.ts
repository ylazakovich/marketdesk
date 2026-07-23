// Human-readable labels for domain enums used across the UI.
import type { ProductCondition, SyncMode, AutonomyLevel, HermesEventType, HermesEvent } from '@shared/types';

export const CONDITION_LABELS: Record<ProductCondition, string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  refurbished: 'Refurbished',
  unknown: 'Requires confirmation',
};

export const CONDITION_LIST: readonly ProductCondition[] = [
  'new',
  'like_new',
  'good',
  'fair',
  'poor',
  'refurbished',
  'unknown',
];

export const SYNC_MODE_LABELS: Record<SyncMode, string> = {
  realtime: 'Real-time',
  hourly: 'Hourly',
  manual: 'Manual',
};

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  suggest_only: 'Suggest only',
  balanced: 'Balanced',
  full_auto: 'Full auto',
};

export const AUTONOMY_DESCRIPTIONS: Record<AutonomyLevel, string> = {
  suggest_only:
    'Hermes surfaces suggestions but never changes anything on its own. Every action waits for your explicit approval.',
  balanced:
    'Hermes auto-applies safe, low-risk actions (relisting, descriptions, new listings) within your guardrails. Pricing and risky changes still require approval.',
  full_auto:
    'Hermes acts autonomously across pricing, listings and content within your guardrails. You are notified after the fact and can always override.',
};

export const HERMES_TYPE_LABELS: Record<HermesEventType, string> = {
  suggested_lower_price: 'Suggested lower price',
  suggested_higher_price: 'Suggested higher price',
  needs_relisting: 'Needs relisting',
  competitor_price_detected: 'Competitor price detected',
  suggested_better_title: 'Suggested better title',
  suggested_more_photos: 'Suggested more photos',
  create_listing: 'Create listing',
  update_description: 'Update description',
  olx_category_mismatch: 'OLX category mismatch',
  product_category_conflict: 'Product category conflict',
  relist: 'Relist',
};

export function conditionLabel(condition: ProductCondition): string {
  return CONDITION_LABELS[condition] ?? condition;
}

export function hermesTypeLabel(type: HermesEventType): string {
  return HERMES_TYPE_LABELS[type] ?? type;
}

export function isSeoRecommendation(event: Pick<HermesEvent, 'type' | 'proposedChange'>): boolean {
  return (
    event.type === 'suggested_better_title' ||
    event.type === 'update_description' ||
    event.proposedChange?.kind === 'title' ||
    event.proposedChange?.kind === 'description'
  );
}

export function recommendationFieldLabel(event: Pick<HermesEvent, 'type' | 'proposedChange'>): string {
  if (event.proposedChange?.kind === 'title') return 'Title';
  if (event.proposedChange?.kind === 'description') return 'Description';
  if (event.proposedChange?.kind === 'price') return 'Price';
  return hermesTypeLabel(event.type);
}
