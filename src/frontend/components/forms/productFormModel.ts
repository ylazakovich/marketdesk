// Shared form-value shape + validation for product create/edit flows.
// Mirrors domain invariants (ARCHITECTURE §3) client-side; the API remains the
// source of truth. sellingPrice < costPrice is a soft warning, not a hard block.
import type { Product, ProductCondition, ProductStatus } from '@shared/types';
import {
  PRODUCT_DESCRIPTION_MIN_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
} from '@shared/constants';

export interface ProductFormValues {
  name: string;
  sku: string;
  description: string;
  costPrice: number;
  sellingPrice: number;
  condition: ProductCondition;
  category: string;
  status: ProductStatus;
  tags: string[];
  images: string[];
}

export type ProductFieldErrors = Partial<Record<keyof ProductFormValues, string>>;

export function emptyProductValues(): ProductFormValues {
  return {
    name: '',
    sku: '',
    description: '',
    costPrice: 0,
    sellingPrice: 0,
    condition: 'good',
    category: '',
    status: 'draft',
    tags: [],
    images: [],
  };
}

export function productToValues(product: Product): ProductFormValues {
  return {
    name: product.name,
    sku: product.sku,
    description: product.description,
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    condition: product.condition,
    category: product.category,
    status: product.status,
    tags: product.tags ?? [],
    images: product.images ?? [],
  };
}

export function validateProductValues(values: ProductFormValues): ProductFieldErrors {
  const errors: ProductFieldErrors = {};
  if (!values.name.trim()) errors.name = 'Name is required.';
  if (!values.sku.trim()) errors.sku = 'SKU is required.';

  const descLen = values.description.trim().length;
  if (descLen < PRODUCT_DESCRIPTION_MIN_LENGTH) {
    errors.description = `Description must be at least ${PRODUCT_DESCRIPTION_MIN_LENGTH} characters.`;
  } else if (descLen > PRODUCT_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be at most ${PRODUCT_DESCRIPTION_MAX_LENGTH} characters.`;
  }

  if (!(values.costPrice >= 0) || Number.isNaN(values.costPrice)) {
    errors.costPrice = 'Cost must be a non-negative number.';
  }
  if (!(values.sellingPrice >= 0) || Number.isNaN(values.sellingPrice)) {
    errors.sellingPrice = 'Price must be a non-negative number.';
  }
  return errors;
}

// Soft warning: selling below cost is allowed but flagged.
export function marginWarning(values: ProductFormValues): string | null {
  if (
    Number.isFinite(values.costPrice) &&
    Number.isFinite(values.sellingPrice) &&
    values.sellingPrice > 0 &&
    values.sellingPrice < values.costPrice
  ) {
    return 'Selling price is below cost — this listing would sell at a loss.';
  }
  return null;
}
