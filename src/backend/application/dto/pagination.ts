// Helpers for building offset/limit paginated responses (ARCHITECTURE.md §18).

import type { PaginatedResponse } from '../../../shared/types';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../shared/constants';

export function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
}

export function normalizeOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.floor(offset);
}

// Paginate an already-materialized, already-sorted array by offset/limit.
export function paginate<TItem, TOut>(
  all: TItem[],
  offset: number,
  limit: number,
  present: (item: TItem) => TOut,
): PaginatedResponse<TOut> {
  const total = all.length;
  const page = Math.floor(offset / limit) + 1;
  const slice = all.slice(offset, offset + limit).map(present);
  return {
    items: slice,
    total,
    page,
    limit,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}
