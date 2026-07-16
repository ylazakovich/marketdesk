// Assembles the /api router from already-constructed controllers. Applies auth and
// rate limiting policy (§18): /auth is public (100/min), every other resource is
// authenticated (1000/min keyed by workspaceId) and workspace-scoped; listing
// price operations additionally get the sensitive limiter (10/min).

import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/AuthController';
import type { ProductController } from '../controllers/ProductController';
import type { ListingController } from '../controllers/ListingController';
import type { MarketplaceController } from '../controllers/MarketplaceController';
import type { HermesController } from '../controllers/HermesController';
import type { AnalyticsController } from '../controllers/AnalyticsController';
import type { WorkspaceController } from '../controllers/WorkspaceController';
import type { ProductImageUploadController } from '../controllers/ProductImageUploadController';
import { authMiddleware, requireWorkspace } from '../middleware/AuthMiddleware';
import {
  publicRateLimiter,
  authenticatedRateLimiter,
  sensitiveRateLimiter,
} from '../middleware/RateLimitMiddleware';
import { createAuthRoutes } from './auth';
import { createProductRoutes } from './products';
import { createListingRoutes } from './listings';
import { createMarketplaceRoutes } from './marketplaces';
import { createHermesRoutes } from './hermes';
import { createAnalyticsRoutes } from './analytics';
import { createWorkspaceRoutes } from './workspaces';
import { createUploadRoutes } from './uploads';
import { asyncHandler } from '../middleware/asyncHandler';

export interface ApiControllers {
  auth: AuthController;
  products: ProductController;
  listings: ListingController;
  marketplaces: MarketplaceController;
  hermes: HermesController;
  analytics: AnalyticsController;
  workspaces: WorkspaceController;
  uploads: ProductImageUploadController;
}

export interface ApiRouterOptions {
  // Rate limiting is stateful across requests; disable it for tests.
  enableRateLimit?: boolean;
  maxUploadFileSize?: number;
}

export function createApiRouter(
  c: ApiControllers,
  options: ApiRouterOptions = {},
): Router {
  const api = Router();
  const rateLimit = options.enableRateLimit ?? false;

  const publicLimiter: RequestHandler | undefined = rateLimit
    ? publicRateLimiter()
    : undefined;
  const authLimiter: RequestHandler | undefined = rateLimit
    ? authenticatedRateLimiter()
    : undefined;
  const sensitiveLimiter: RequestHandler | undefined = rateLimit
    ? sensitiveRateLimiter()
    : undefined;

  // Public
  api.use('/auth', createAuthRoutes(c.auth, publicLimiter));
  api.get(
    '/marketplaces/:provider/oauth/callback',
    ...(publicLimiter ? [publicLimiter] : []),
    asyncHandler(c.marketplaces.callback),
  );

  // Protected + workspace-scoped
  const guard: RequestHandler[] = [authMiddleware];
  if (authLimiter) guard.push(authLimiter);
  guard.push(requireWorkspace);

  api.use('/products', ...guard, createProductRoutes(c.products));
  api.use('/listings', ...guard, createListingRoutes(c.listings, sensitiveLimiter));
  api.use('/marketplaces', ...guard, createMarketplaceRoutes(c.marketplaces));
  api.use('/hermes', ...guard, createHermesRoutes(c.hermes));
  api.use('/analytics', ...guard, createAnalyticsRoutes(c.analytics));
  api.use('/workspaces', ...guard, createWorkspaceRoutes(c.workspaces));
  api.use(
    '/uploads',
    ...guard,
    createUploadRoutes(c.uploads, options.maxUploadFileSize ?? 52_428_800),
  );

  return api;
}
