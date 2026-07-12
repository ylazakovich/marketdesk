// Thin HTTP adapter for workspace settings. No workspace application service exists;
// reads/writes go through the injected repository. Update rebuilds the aggregate via
// its validated factory (currency/timezone are immutable on the entity) preserving
// identity, creation time and guardrails, then persists.

import type { Request, Response, NextFunction } from 'express';
import type { IWorkspaceRepository } from '../../../domain/repositories/interfaces/IWorkspaceRepository';
import type { Workspace as WorkspaceEntity } from '../../../domain/entities/Workspace';
import type { Workspace as WorkspaceView, AutonomyLevel } from '../../../../shared/types';
import { Workspace } from '../../../domain/entities/Workspace';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { ok } from '../formatters/ResponseFormatter';

function presentWorkspace(ws: WorkspaceEntity): WorkspaceView {
  return {
    id: ws.id,
    name: ws.name,
    currency: ws.currency,
    timezone: ws.timezone,
    autonomyLevel: ws.autonomyLevel,
    guardrails: ws.guardrails,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString(),
  };
}

export class WorkspaceController {
  constructor(private readonly workspaceRepo: IWorkspaceRepository) {}

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // A caller may only read their OWN workspace. The :id path param is ignored;
    // the tenant comes from the authenticated principal so a cross-tenant id
    // cannot be read (S2).
    const workspaceId = req.user!.workspaceId!;
    const ws = await this.workspaceRepo.findById(workspaceId);
    if (!ws) return next(new NotFoundError(`Workspace not found: ${workspaceId}`));
    ok(res, presentWorkspace(ws));
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Ignore req.params.id; operate only on the caller's own workspace (S2).
    const workspaceId = req.user!.workspaceId!;
    const current = await this.workspaceRepo.findById(workspaceId);
    if (!current) {
      return next(new NotFoundError(`Workspace not found: ${workspaceId}`));
    }
    const rebuilt = Workspace.create({
      id: current.id,
      name: typeof req.body?.name === 'string' ? req.body.name : current.name,
      currency:
        typeof req.body?.currency === 'string' ? req.body.currency : current.currency,
      timezone:
        typeof req.body?.timezone === 'string' ? req.body.timezone : current.timezone,
      autonomyLevel:
        typeof req.body?.autonomyLevel === 'string'
          ? (req.body.autonomyLevel as AutonomyLevel)
          : current.autonomyLevel,
      guardrails: current.guardrails,
      createdAt: current.createdAt,
    });
    if (rebuilt.isErr()) return next(rebuilt.error);
    await this.workspaceRepo.save(rebuilt.value);
    ok(res, presentWorkspace(rebuilt.value));
  };
}
