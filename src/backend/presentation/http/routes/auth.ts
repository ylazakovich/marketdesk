// Auth routes. login/register are public (public rate limiter when supplied); /me is
// protected by the JWT auth middleware.

import rateLimit from 'express-rate-limit';
import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/AuthController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { validateBody } from '../middleware/ValidationMiddleware';
import { loginSchema, registerSchema } from '../validation/schemas';

const passthrough: RequestHandler = (_req, _res, next) => next();

// Rate limit for authenticated endpoints: protect against abuse by authenticated users
const authLimiter: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  keyGenerator: (req) => req.user?.userId || req.ip || 'unknown',
  skip: () => process.env.NODE_ENV === 'test',
});

export function createAuthRoutes(
  controller: AuthController,
  publicLimiter: RequestHandler = passthrough,
): Router {
  const router = Router();
  const limiter = publicLimiter ?? passthrough;

  router.post('/login', limiter, validateBody(loginSchema), asyncHandler(controller.login));
  router.post(
    '/register',
    limiter,
    validateBody(registerSchema),
    asyncHandler(controller.register),
  );
  // Rate limit before auth to protect the authorization check from brute-force attacks
  router.get('/me', authLimiter, authMiddleware, asyncHandler(controller.me));
  return router;
}
