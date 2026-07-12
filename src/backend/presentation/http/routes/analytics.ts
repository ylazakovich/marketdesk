// Analytics/dashboard routes.

import { Router } from 'express';
import type { AnalyticsController } from '../controllers/AnalyticsController';
import { asyncHandler } from '../middleware/asyncHandler';

export function createAnalyticsRoutes(controller: AnalyticsController): Router {
  const router = Router();
  router.get('/overview', asyncHandler(controller.overview));
  router.get('/revenue', asyncHandler(controller.revenue));
  router.get('/listings', asyncHandler(controller.listings));
  return router;
}
