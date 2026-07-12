// Boundary validation for pricing-related input: raw price values and the price
// range / query filters used when listing products. Monetary invariants relative to
// cost stay in the Product entity; this only checks well-formedness (finite, >= 0,
// coherent min/max) and normalizes the list-products query.

import { z } from 'zod';
import { Result, Ok, Err } from '../../domain/shared/Result';
import { ValidationError } from '../../domain/shared/DomainError';
import { PRODUCT_STATUS_LIST } from '../../../shared/constants';
import type { ProductStatus } from '../../../shared/types';
import type { ListProductsQueryDTO, SortKey } from '../dto/ListProductsQueryDTO';

const priceSchema = z.number().finite().nonnegative();

const listQuerySchema = z
  .object({
    workspaceId: z.string().trim().min(1, 'workspaceId is required'),
    status: z
      .array(z.enum(PRODUCT_STATUS_LIST as unknown as [ProductStatus, ...ProductStatus[]]))
      .optional(),
    priceMin: priceSchema.optional(),
    priceMax: priceSchema.optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    search: z.string().trim().min(1).optional(),
    sort: z
      .array(
        z.object({
          field: z.string().trim().min(1),
          dir: z.enum(['asc', 'desc']),
        }),
      )
      .optional(),
    limit: z.number().int().positive().max(100).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .refine(
    (q) => q.priceMin === undefined || q.priceMax === undefined || q.priceMin <= q.priceMax,
    { message: 'priceMin must be <= priceMax' },
  );

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid input';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export class PricingValidator {
  // Validate a raw price value (major units).
  validatePrice(value: unknown): Result<number> {
    const parsed = priceSchema.safeParse(value);
    if (!parsed.success) {
      return Err(new ValidationError(firstIssue(parsed.error)));
    }
    return Ok(parsed.data);
  }

  // Validate + normalize a list-products query (filters, sort, pagination).
  validateListQuery(input: unknown): Result<ListProductsQueryDTO> {
    const parsed = listQuerySchema.safeParse(input);
    if (!parsed.success) {
      return Err(new ValidationError(firstIssue(parsed.error)));
    }
    return Ok(parsed.data as ListProductsQueryDTO);
  }
}

export type { SortKey };
