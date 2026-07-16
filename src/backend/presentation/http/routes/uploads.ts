import { raw, Router } from 'express';
import type { ProductImageUploadController } from '../controllers/ProductImageUploadController';
import { asyncHandler } from '../middleware/asyncHandler';

export function createUploadRoutes(
  controller: ProductImageUploadController,
  maxFileSize: number,
): Router {
  const router = Router();
  router.post(
    '/images',
    raw({ type: '*/*', limit: maxFileSize }),
    asyncHandler(controller.upload),
  );
  router.delete('/images/:id', asyncHandler(controller.delete));
  return router;
}
