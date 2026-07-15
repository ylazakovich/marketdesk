// Input DTO for updating a product. All mutable fields are optional; only the
// provided fields are applied. Status transitions remain forward-only (enforced
// by the Product entity).

import type { ProductStatus, ProductCondition } from '../../../shared/types';

export interface UpdateProductDTO {
  productId: string;
  // Tenant the caller is acting within (from the authenticated principal, never
  // the request body). The update is rejected if the product is in another
  // workspace (S2).
  workspaceId: string;
  name?: string;
  description?: string;
  costPrice?: number;
  sellingPrice?: number;
  currency?: string;
  condition?: ProductCondition;
  category?: string;
  status?: ProductStatus;
  tags?: string[];
  images?: string[];
  allowBelowCost?: boolean;
}
