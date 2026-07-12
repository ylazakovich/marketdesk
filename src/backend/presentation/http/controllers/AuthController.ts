// Thin HTTP adapter for authentication. Verifies credentials with bcrypt, issues a
// JWT carrying { userId, workspaceId } (the tenant bootstrap the frontend needs), and
// exposes the current principal. User persistence is abstracted behind IAuthUserStore
// (Group 6 wires a concrete backed by the `users` table). Optional register also
// bootstraps a workspace when a name is supplied.

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import type { IAuthUserStore } from '../ports/IAuthUserStore';
import type { IWorkspaceRepository } from '../../../domain/repositories/interfaces/IWorkspaceRepository';
import { Workspace } from '../../../domain/entities/Workspace';
import { ConflictError } from '../../../domain/shared/DomainError';
import { ERROR_CODES } from '../../../../shared/constants';
import { ok, created, fail } from '../formatters/ResponseFormatter';
import { signToken } from '../middleware/AuthMiddleware';

const BCRYPT_ROUNDS = 10;

// A fixed bcrypt hash of a random string. When login is attempted for an
// unknown email we still run bcrypt.compare against this so both the
// user-found and user-not-found paths take similar time, closing a user
// enumeration timing side-channel. (S6)
const DUMMY_PASSWORD_HASH =
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

interface AuthUserView {
  id: string;
  email: string;
  workspaceId?: string;
}

function toUserView(user: {
  id: string;
  email: string;
  workspaceId?: string | null;
}): AuthUserView {
  return {
    id: user.id,
    email: user.email,
    workspaceId: user.workspaceId ?? undefined,
  };
}

export class AuthController {
  constructor(
    private readonly users: IAuthUserStore,
    private readonly workspaceRepo?: IWorkspaceRepository,
  ) {}

  login = async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body as { email: string; password: string };
    const user = await this.users.findByEmail(email);
    // Always run one bcrypt.compare so the not-found path costs the same as the
    // wrong-password path (constant-time-ish; no user enumeration via timing). (S6)
    const passwordOk = await bcrypt.compare(
      password ?? '',
      user ? user.passwordHash : DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordOk) {
      fail(res, undefined, 401, {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
      return;
    }
    const token = signToken({
      userId: user.id,
      workspaceId: user.workspaceId ?? undefined,
    });
    ok(res, { token, user: toUserView(user) });
  };

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { email, password, workspaceName } = req.body as {
      email: string;
      password: string;
      workspaceName?: string;
    };
    const existing = await this.users.findByEmail(email);
    if (existing) {
      return next(new ConflictError(`Email already registered: ${email}`));
    }

    let workspaceId: string | undefined;
    if (workspaceName && this.workspaceRepo) {
      const ws = Workspace.create({ id: randomUUID(), name: workspaceName });
      if (ws.isErr()) return next(ws.error);
      await this.workspaceRepo.save(ws.value);
      workspaceId = ws.value.id;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await this.users.create({ email, passwordHash, workspaceId });
    const token = signToken({ userId: user.id, workspaceId: user.workspaceId ?? undefined });
    created(res, { token, user: toUserView(user) });
  };

  me = async (req: Request, res: Response): Promise<void> => {
    const user = await this.users.findById(req.user!.userId);
    if (!user) {
      fail(res, undefined, 401, {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'User no longer exists',
      });
      return;
    }
    ok(res, toUserView(user));
  };
}
