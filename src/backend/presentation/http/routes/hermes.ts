// Hermes (autonomous agent) routes.

import { Router } from 'express';
import type { HermesController } from '../controllers/HermesController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import {
  approveEventSchema,
  approveCategoryCorrectionOperationSchema,
  executeCategoryCorrectionOperationSchema,
  dismissEventSchema,
  runHermesSchema,
} from '../validation/schemas';

export function createHermesRoutes(controller: HermesController): Router {
  const router = Router();
  router.get('/events', asyncHandler(controller.list));
  router.get('/events/:id', asyncHandler(controller.get));
  router.get('/events/:id/category-correction-operations', asyncHandler(controller.listCategoryCorrectionOperations));
  router.post(
    '/category-correction-operations/:operationId/approve',
    validateBody(approveCategoryCorrectionOperationSchema),
    asyncHandler(controller.approveCategoryCorrectionOperation),
  );
  router.post(
    '/category-correction-operations/:operationId/execute',
    validateBody(executeCategoryCorrectionOperationSchema),
    asyncHandler(controller.executeCategoryCorrectionOperation),
  );
  router.post(
    '/events/:id/approve',
    validateBody(approveEventSchema),
    asyncHandler(controller.approve),
  );
  router.post(
    '/events/:id/dismiss',
    validateBody(dismissEventSchema),
    asyncHandler(controller.dismiss),
  );
  router.post('/run', validateBody(runHermesSchema), asyncHandler(controller.run));
  return router;
}
