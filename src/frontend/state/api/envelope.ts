// Response-envelope helpers. The backend wraps every payload per ARCHITECTURE §18:
//   success → { success: true, data: T }
//   paginated → { success: true, data: T[], pagination: {...} }
//   error → { success: false, error: { code, message, details? } }
// These `transformResponse` helpers unwrap the envelope so RTK Query hooks expose
// the payload directly. HTTP-level failures are already surfaced as RTK Query
// errors by fetchBaseQuery; here we only guard against malformed 2xx bodies.
import type { ApiResponse, PaginatedResponse } from '@shared/types';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Wire shape of a paginated success response. Differs from the client-facing
// `PaginatedResponse<T>` (which uses `items` + flattened counts).
export interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  pagination: PaginationMeta;
  error?: ApiResponse<never>['error'];
}

export function unwrap<T>(res: ApiResponse<T>): T {
  if (!res.success || res.data === undefined) {
    throw new Error(res.error?.message ?? 'Request failed');
  }
  return res.data;
}

export function unwrapPaginated<T>(res: PaginatedApiResponse<T>): PaginatedResponse<T> {
  if (!res.success) {
    throw new Error(res.error?.message ?? 'Request failed');
  }
  return {
    items: res.data,
    total: res.pagination.total,
    page: res.pagination.page,
    limit: res.pagination.limit,
    totalPages: res.pagination.totalPages,
  };
}
