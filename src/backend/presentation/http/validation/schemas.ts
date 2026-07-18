// Zod schemas for request-body validation at the HTTP boundary. These mirror the
// application input DTOs (which are plain TS interfaces) and enforce transport-level
// shape/type correctness before a request reaches a controller/use case. Business
// rules (e.g. selling price below cost, status transitions) remain the domain's
// responsibility and surface as DomainError -> HTTP via ErrorHandlingMiddleware.
//
// workspaceId is intentionally NOT part of these schemas: it is derived from the
// authenticated principal (req.user.workspaceId), never trusted from the client body.

import { z } from 'zod';
import { requireBelowCostConfirmation } from '../../../../shared/validation/pricing';
import {
  PRODUCT_STATUS_LIST,
  AUTONOMY_LEVEL_LIST,
  SYNC_MODE_LIST,
  MARKETPLACE_KEY_LIST,
} from '../../../../shared/constants';

const conditionEnum = z.enum(['new', 'like_new', 'good', 'fair', 'poor', 'refurbished', 'unknown']);

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone');

const nonEmptyPatch = (value: object) => Object.keys(value).length > 0;

export const createProductSchema = z
  .object({
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
  })
  .superRefine(requireBelowCostConfirmation);

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
  .superRefine(requireBelowCostConfirmation)
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
      const imageCount =
        body.imageUrls && body.imageUrls.length > 0
          ? body.imageUrls.length
          : (body.existingFields?.images?.length ?? 0);
      if (imageCount === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['imageUrls'],
          message: 'At least one photo URL is required',
        });
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
  quotaOverride: z
    .object({
      confirmed: z.literal(true),
      reason: z.string().trim().min(10).max(500),
    })
    .optional(),
});

export const marketplaceCategorySchema = z.object({
  providerCategoryId: z.string().trim().min(1).max(100),
});

export const setOlxPublicationQuotaSchema = z.object({
  subcategoryId: z.string().trim().min(1).max(100),
  cycleStartedAt: z.iso.datetime(),
  cycleEndsAt: z.iso.datetime(),
  publicationLimit: z.number().int().nonnegative(),
  consumed: z.number().int().nonnegative(),
  source: z.enum(['operator', 'provider', 'reconciled']),
  confidence: z.enum(['verified', 'estimated']),
  verifiedAt: z.iso.datetime(),
  staleAt: z.iso.datetime(),
});

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    timezone: timezoneSchema.optional(),
    language: z.enum(['en', 'pl']).optional(),
    autonomyLevel: z.enum(AUTONOMY_LEVEL_LIST as [string, ...string[]]).optional(),
  })
  .strict()
  .refine(nonEmptyPatch, { message: 'At least one field must be provided' });

export const updateWorkspaceSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    timezone: timezoneSchema.optional(),
    language: z.enum(['en', 'pl']).optional(),
  })
  .strict()
  .refine(nonEmptyPatch, { message: 'At least one field must be provided' });

export const updateUserPreferencesSchema = z
  .object({
    themeMode: z.enum(['system', 'light', 'dark']).optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
  })
  .strict()
  .refine(nonEmptyPatch, { message: 'At least one field must be provided' });

const notificationChannelsSchema = z
  .object({
    email: z.boolean().optional(),
    inApp: z.boolean().optional(),
    telegram: z.boolean().optional(),
  })
  .strict()
  .refine(nonEmptyPatch, { message: 'At least one channel must be provided' });

export const updateNotificationPreferencesSchema = z
  .object({
    events: z
      .object({
        new_sale: notificationChannelsSchema.optional(),
        competitor_price_change: notificationChannelsSchema.optional(),
        listing_needs_attention: notificationChannelsSchema.optional(),
        sync_error: notificationChannelsSchema.optional(),
        weekly_performance_report: notificationChannelsSchema.optional(),
      })
      .strict()
      .refine(nonEmptyPatch, { message: 'At least one event must be provided' }),
  })
  .strict();

export const updateHermesSettingsSchema = z
  .object({
    autonomyLevel: z.enum(AUTONOMY_LEVEL_LIST as [string, ...string[]]).optional(),
    guardrails: z
      .object({
        maxAutoPriceChangePct: z.number().min(0).max(100).optional(),
        minMarginFloor: z.number().min(0).max(100).optional(),
        autoCreateListings: z.boolean().optional(),
        autoAdjustPricing: z.boolean().optional(),
        autoRelist: z.boolean().optional(),
        smartTitleAndSEO: z.boolean().optional(),
      })
      .strict()
      .refine(nonEmptyPatch, { message: 'At least one guardrail must be provided' })
      .optional(),
  })
  .strict()
  .refine(nonEmptyPatch, { message: 'At least one field must be provided' });

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

export const approveCategoryCorrectionOperationSchema = z.object({
  paidOverrideReason: z.string().trim().min(10).max(500).optional(),
});

export const executeCategoryCorrectionOperationSchema = z.object({});
