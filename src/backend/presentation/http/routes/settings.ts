import { Router } from 'express';
import type { SettingsController } from '../controllers/SettingsController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import {
  updateHermesSettingsSchema,
  updateNotificationPreferencesSchema,
  updateUserPreferencesSchema,
  updateWorkspaceSettingsSchema,
} from '../validation/schemas';

export function createSettingsRoutes(controller: SettingsController): Router {
  const router = Router();
  router.get('/workspace', asyncHandler(controller.getWorkspace));
  router.patch(
    '/workspace',
    validateBody(updateWorkspaceSettingsSchema),
    asyncHandler(controller.updateWorkspace)
  );
  router.get('/preferences', asyncHandler(controller.getPreferences));
  router.patch(
    '/preferences',
    validateBody(updateUserPreferencesSchema),
    asyncHandler(controller.updatePreferences)
  );
  router.get('/notifications', asyncHandler(controller.getNotifications));
  router.patch(
    '/notifications',
    validateBody(updateNotificationPreferencesSchema),
    asyncHandler(controller.updateNotifications)
  );
  router.get('/hermes', asyncHandler(controller.getHermes));
  router.patch(
    '/hermes',
    validateBody(updateHermesSettingsSchema),
    asyncHandler(controller.updateHermes)
  );
  router.get('/integrations', asyncHandler(controller.getIntegrations));
  return router;
}
