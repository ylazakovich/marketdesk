// Marketplace routes.

import { Router } from 'express';
import type { MarketplaceController } from '../controllers/MarketplaceController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import { updateMarketplaceSchema } from '../validation/schemas';

export function createMarketplaceRoutes(controller: MarketplaceController): Router {
  const router = Router();
  router.get('/', asyncHandler(controller.list));
  router.get('/:id', asyncHandler(controller.get));
  router.post('/:id/sync', asyncHandler(controller.sync));
  router.post('/:id/connect', asyncHandler(controller.connect));
  router.patch('/:id', validateBody(updateMarketplaceSchema), asyncHandler(controller.update));
  return router;
}
