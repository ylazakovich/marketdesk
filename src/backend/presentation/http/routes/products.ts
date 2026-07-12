// Product routes (§18 REST conventions). Auth is applied by the API router when this
// is mounted; validation is applied on writes.

import { Router } from 'express';
import type { ProductController } from '../controllers/ProductController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import { createProductSchema, updateProductSchema } from '../validation/schemas';

export function createProductRoutes(controller: ProductController): Router {
  const router = Router();
  router.get('/', asyncHandler(controller.list));
  router.post('/', validateBody(createProductSchema), asyncHandler(controller.create));
  router.get('/:id', asyncHandler(controller.get));
  router.patch('/:id', validateBody(updateProductSchema), asyncHandler(controller.update));
  router.delete('/:id', asyncHandler(controller.remove));
  router.get('/:id/listings', asyncHandler(controller.getListings));
  return router;
}
