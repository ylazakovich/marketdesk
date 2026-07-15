// Boundary (shape/format) validation for product DTOs using zod. Business
// invariants (price/currency relationships, forward-only status, description bounds) live in the
// Product entity — these validators only guarantee well-formed input, then return a
// domain Result so the rest of the application stays railway-oriented.

import { z } from 'zod';
import { Result, Ok, Err } from '../../domain/shared/Result';
import { ValidationError } from '../../domain/shared/DomainError';
import {
  PRODUCT_STATUS_LIST,
  PRODUCT_DESCRIPTION_MIN_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
} from '../../../shared/constants';
import type { ProductStatus, ProductCondition } from '../../../shared/types';
import type { CreateProductDTO } from '../dto/CreateProductDTO';
import type { UpdateProductDTO } from '../dto/UpdateProductDTO';

const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor', 'refurbished'] as const;

const conditionSchema = z.enum(CONDITIONS);
const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be an ISO-4217 code');

const createProductSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  sku: z.string().trim().min(1, 'sku is required'),
  name: z.string().trim().min(1, 'name is required'),
  description: z
    .string()
    .min(PRODUCT_DESCRIPTION_MIN_LENGTH)
    .max(PRODUCT_DESCRIPTION_MAX_LENGTH),
  costPrice: z.number().finite().nonnegative(),
  sellingPrice: z.number().finite().nonnegative(),
  currency: currencySchema.optional(),
  condition: conditionSchema,
  category: z.string().trim().min(1, 'category is required'),
  tags: z.array(z.string().trim().min(1)).optional(),
  images: z.array(z.string().trim().min(1)).optional(),
  allowBelowCost: z.boolean().optional(),
});

const updateProductSchema = z
  .object({
    productId: z.string().trim().min(1, 'productId is required'),
    // Preserved through validation so the use case can enforce tenant ownership (S2).
    workspaceId: z.string().trim().min(1, 'workspaceId is required'),
    name: z.string().trim().min(1).optional(),
    description: z
      .string()
      .min(PRODUCT_DESCRIPTION_MIN_LENGTH)
      .max(PRODUCT_DESCRIPTION_MAX_LENGTH)
      .optional(),
    costPrice: z.number().finite().nonnegative().optional(),
    sellingPrice: z.number().finite().nonnegative().optional(),
    currency: currencySchema.optional(),
    condition: conditionSchema.optional(),
    category: z.string().trim().min(1, 'category is required').optional(),
    status: z.enum(PRODUCT_STATUS_LIST as unknown as [ProductStatus, ...ProductStatus[]]).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    images: z.array(z.string().trim().min(1)).optional(),
    allowBelowCost: z.boolean().optional(),
  })
  .refine(
    (dto) =>
      dto.name !== undefined ||
      dto.description !== undefined ||
      dto.costPrice !== undefined ||
      dto.sellingPrice !== undefined ||
      dto.currency !== undefined ||
      dto.condition !== undefined ||
      dto.category !== undefined ||
      dto.status !== undefined ||
      dto.tags !== undefined ||
      dto.images !== undefined ||
      dto.allowBelowCost !== undefined,
    { message: 'at least one field must be provided to update' },
  );

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid input';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export class ProductValidator {
  validateCreate(input: unknown): Result<CreateProductDTO> {
    const parsed = createProductSchema.safeParse(input);
    if (!parsed.success) {
      return Err(new ValidationError(firstIssue(parsed.error)));
    }
    return Ok(parsed.data as CreateProductDTO);
  }

  validateUpdate(input: unknown): Result<UpdateProductDTO> {
    const parsed = updateProductSchema.safeParse(input);
    if (!parsed.success) {
      return Err(new ValidationError(firstIssue(parsed.error)));
    }
    return Ok(parsed.data as UpdateProductDTO);
  }
}

export type { ProductCondition };
