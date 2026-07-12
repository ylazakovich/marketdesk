// Workspace settings routes.

import { Router } from 'express';
import type { WorkspaceController } from '../controllers/WorkspaceController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import { updateWorkspaceSchema } from '../validation/schemas';

export function createWorkspaceRoutes(controller: WorkspaceController): Router {
  const router = Router();
  router.get('/:id', asyncHandler(controller.get));
  router.patch('/:id', validateBody(updateWorkspaceSchema), asyncHandler(controller.update));
  return router;
}
