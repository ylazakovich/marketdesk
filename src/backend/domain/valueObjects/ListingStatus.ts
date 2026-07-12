// ListingStatus value object: the canonical listing lifecycle and its legal
// transitions. Statuses per ARCHITECTURE.md §3/§7: live | draft | expired | error.

import type { ListingStatus } from '../../../shared/types';

export const LISTING_STATUSES: readonly ListingStatus[] = [
  'draft',
  'live',
  'expired',
  'error',
];

// Allowed transitions. Keys are the current status; values are reachable next
// statuses. draft -> live (publish), live -> expired (lapse), live -> error /
// draft -> error (sync/publish failure), expired -> live (relist),
// error -> live / error -> draft (recovery).
const TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ['live', 'error'],
  live: ['expired', 'error'],
  expired: ['live', 'error'],
  error: ['live', 'draft'],
};

export function isValidListingStatus(value: string): value is ListingStatus {
  return (LISTING_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: ListingStatus, to: ListingStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: ListingStatus): readonly ListingStatus[] {
  return TRANSITIONS[from];
}
