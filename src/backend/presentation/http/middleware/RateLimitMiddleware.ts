// Rate limiting per ARCHITECTURE.md §18:
//   - public routes (auth):        100 req/min per IP
//   - authenticated routes:      1000 req/min keyed by workspaceId (fallback IP)
//   - sensitive price operations:  10 req/min keyed by workspaceId (fallback IP)
// All limiters emit the §18 error envelope (429, RATE_LIMITED) on rejection.

import type { Request, Response } from 'express';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

const WINDOW_MS = 60 * 1000;

function keyByWorkspace(req: Request): string {
  return req.user?.workspaceId ?? req.ip ?? 'unknown';
}

function rejection(_req: Request, res: Response): void {
  res.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' },
  });
}

function build(limit: number, keyGenerator?: (req: Request) => string): RateLimitRequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: rejection,
  });
}

export function publicRateLimiter(): RateLimitRequestHandler {
  // Default keyGenerator (IP-based, IPv6-safe) is applied when none is supplied.
  return build(100);
}

export function authenticatedRateLimiter(): RateLimitRequestHandler {
  return build(1000, keyByWorkspace);
}

export function sensitiveRateLimiter(): RateLimitRequestHandler {
  return build(10, keyByWorkspace);
}
