// Query DTO for listing products (ARCHITECTURE.md §18 filtering & sorting).
//   status=active,attention  priceMin=100 priceMax=1000  tags=a,b
//   sort=-updatedAt,+name     limit=25 offset=0
// The controller (Group 5) parses the query string into this shape.

import type { ProductStatus } from '../../../shared/types';

// A single sort key: field + direction. e.g. "-updatedAt" => { field: 'updatedAt', dir: 'desc' }.
export interface SortKey {
  field: string;
  dir: 'asc' | 'desc';
}

export interface ListProductsQueryDTO {
  workspaceId: string;
  status?: ProductStatus[];
  priceMin?: number;
  priceMax?: number;
  tags?: string[];
  // Full-text-ish match against name/sku/description (case-insensitive contains).
  search?: string;
  sort?: SortKey[];
  limit?: number;
  offset?: number;
}
