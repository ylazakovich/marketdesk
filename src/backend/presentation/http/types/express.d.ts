// Express Request augmentation. AuthMiddleware attaches the authenticated principal
// (extracted from the JWT) so downstream controllers can read workspace/user context.

import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        workspaceId?: string;
      };
    }
  }
}

export {};
