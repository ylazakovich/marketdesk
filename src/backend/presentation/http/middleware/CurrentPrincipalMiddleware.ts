import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES } from '../../../../shared/constants';
import type { IAuthUserStore } from '../ports/IAuthUserStore';
import { fail } from '../formatters/ResponseFormatter';

export function requireCurrentWorkspacePrincipal(users: IAuthUserStore): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const jwtPrincipal = req.user!;
    const current = await users.findById(jwtPrincipal.userId);
    if (!current) {
      fail(res, undefined, 401, {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authenticated user no longer exists',
      });
      return;
    }
    if (!current.workspaceId || current.workspaceId !== jwtPrincipal.workspaceId) {
      fail(res, undefined, 403, {
        code: ERROR_CODES.FORBIDDEN,
        message: 'Authenticated workspace membership has changed',
      });
      return;
    }
    next();
  };
}
