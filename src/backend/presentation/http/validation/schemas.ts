// Zod schemas for request-body validation at the HTTP boundary. These mirror the
// application input DTOs (which are plain TS interfaces) and enforce transport-level
// shape/type correctness before a request reaches a controller/use case. Business
// rules (e.g. selling price below cost, status transitions) remain the domain's
// responsibility and surface as DomainError -> HTTP via ErrorHandlingMiddleware.
//
// workspaceId is intentionally NOT part of these schemas: it is derived from the
// authenticated principal (req.user.workspaceId), never trusted from the client body.

import { z } from 'zod';
import {
  PRODUCT_STATUS_LIST,
  AUTONOMY_LEVEL_LIST,
  SYNC_MODE_LIST,
  MARKETPLACE_KEY_LIST,
} from '../../../../shared/constants';

const conditionEnum = z.enum(['new', 'like_new', 'good', 'fair', 'poor', 'refurbished', 'unknown']);

export const createProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  costPrice: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  condition: conditionEnum,
  category: z.string().min(1),
  tags: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  allowBelowCost: z.boolean().optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    costPrice: z.number().nonnegative().nullable().optional(),
    sellingPrice: z.number().nonnegative().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    condition: conditionEnum.optional(),
    category: z.string().trim().min(1).optional(),
    status: z.enum(PRODUCT_STATUS_LIST as [string, ...string[]]).optional(),
    tags: z.array(z.string()).optional(),
    images: z.array(z.string()).optional(),
    allowBelowCost: z.boolean().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided',
  });

export const productAIDraftSchema = z
  .object({
    mode: z.enum(['photos', 'title']),
    title: z.string().trim().min(1).optional(),
    imageUrls: z.array(z.string().trim().min(1)).optional(),
    existingFields: z
      .object({
        sku: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        costPrice: z.number().nonnegative().nullable().optional(),
        sellingPrice: z.number().nonnegative().optional(),
        condition: conditionEnum.optional(),
        category: z.string().optional(),
        status: z.enum(PRODUCT_STATUS_LIST as [string, ...string[]]).optional(),
        tags: z.array(z.string()).optional(),
        images: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .superRefine((body, ctx) => {
    if (body.mode === 'title' && !body.title && !body.existingFields?.name) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'Title is required' });
    }
    if (body.mode === 'photos') {
      const imageCount = body.imageUrls && body.imageUrls.length > 0
        ? body.imageUrls.length
        : body.existingFields?.images?.length ?? 0;
      if (imageCount === 0) {
        ctx.addIssue({ code: 'custom', path: ['imageUrls'], message: 'At least one photo URL is required' });
      }
    }
  });

export const createListingSchema = z.object({
  marketplaceKey: z.enum(MARKETPLACE_KEY_LIST as [string, ...string[]]).default('olx'),
  price: z.number().nonnegative().optional(),
});

export const publishListingSchema = z.object({
  actorId: z.string().optional(),
  dryRun: z.boolean().optional(),
});

export const updateWorkspaceSchema = z
  .object({
    name: z.string().min(1).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    timezone: z.string().min(1).optional(),
    autonomyLevel: z.enum(AUTONOMY_LEVEL_LIST as [string, ...string[]]).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided',
  });

export const updateMarketplaceSchema = z
  .object({
    connected: z.boolean().optional(),
    syncMode: z.enum(SYNC_MODE_LIST as [string, ...string[]]).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided',
  });

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  workspaceName: z.string().min(1).optional(),
});

export const runHermesSchema = z.object({
  trigger: z.enum(['scheduled', 'manual', 'event']).optional(),
});

export const dismissEventSchema = z.object({
  actorId: z.string().optional(),
  reason: z.string().optional(),
});

export const approveEventSchema = z.object({
  actorId: z.string().optional(),
});
