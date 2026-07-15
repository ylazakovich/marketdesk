// Marketplace routes.

import { Router } from 'express';
import type { MarketplaceController } from '../controllers/MarketplaceController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import { setOlxPublicationQuotaSchema, updateMarketplaceSchema } from '../validation/schemas';

export function createMarketplaceRoutes(controller: MarketplaceController): Router {
  const router = Router();
  router.get('/', asyncHandler(controller.list));
  router.get('/:id', asyncHandler(controller.get));
  router.get('/:id/quotas', asyncHandler(controller.listQuotas));
  router.put(
    '/:id/quotas',
    validateBody(setOlxPublicationQuotaSchema),
    asyncHandler(controller.setQuota),
  );
  router.post('/:id/sync', asyncHandler(controller.sync));
  router.post('/:id/connect', asyncHandler(controller.connect));
  router.get('/:id/app-credentials', asyncHandler(controller.getAppCredentials));
  router.put('/:id/app-credentials', asyncHandler(controller.saveAppCredentials));
  router.delete('/:id/app-credentials', asyncHandler(controller.removeAppCredentials));
  router.get('/:id/check', asyncHandler(controller.check));
  router.post('/:id/import-preview', asyncHandler(controller.importPreview));
  router.post('/:id/import', asyncHandler(controller.importApply));
  router.patch('/:id', validateBody(updateMarketplaceSchema), asyncHandler(controller.update));
  return router;
}
