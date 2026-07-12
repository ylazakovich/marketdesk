// JWT authentication middleware. Verifies the Bearer token (HS256, secret from env)
// and attaches req.user = { userId, workspaceId }. On any failure it sends a 401
// error envelope directly (an unauthenticated request is not an application error to
// route through the domain error handler).

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { ERROR_CODES } from '../../../../shared/constants';
import { fail } from '../formatters/ResponseFormatter';

export interface JwtPayload {
  userId: string;
  workspaceId?: string;
}

export function signToken(payload: JwtPayload): string {
  const options = { expiresIn: env.jwt.expiration } as jwt.SignOptions;
  return jwt.sign(payload, env.jwt.secret, options);
}

function unauthorized(res: Response, message: string): Response {
  return fail(res, undefined, 401, { code: ERROR_CODES.UNAUTHORIZED, message });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    unauthorized(res, 'Missing or malformed Authorization header');
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    // Pin the algorithm to HS256 so a token cannot be verified under an
    // attacker-chosen algorithm (e.g. "none" or an RS/HS confusion). (S5)
    const decoded = jwt.verify(token, env.jwt.secret, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload & JwtPayload;
    if (!decoded.userId) {
      unauthorized(res, 'Invalid token payload');
      return;
    }
    req.user = { userId: decoded.userId, workspaceId: decoded.workspaceId };
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
}

// Guarantees req.user.workspaceId is present (multi-tenant routes). Use after
// authMiddleware on routes that read/write workspace-scoped data.
export function requireWorkspace(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user?.workspaceId) {
    fail(res, undefined, 403, {
      code: ERROR_CODES.FORBIDDEN,
      message: 'No workspace associated with this account',
    });
    return;
  }
  next();
}
