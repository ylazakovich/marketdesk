// Thin HTTP adapter for marketplace resources. Reads and simple connection/sync-mode
// transitions run against the injected repository (no marketplace application service
// exists yet); the async sync enqueue delegates to ListingApplicationService.

import type { Request, Response, NextFunction } from 'express';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { ListingApplicationService } from '../../../application/services/ListingApplicationService';
import type { SyncMode } from '../../../../shared/types';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { presentMarketplace } from '../../../application/dto/presenters';
import { ok } from '../formatters/ResponseFormatter';


function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export class MarketplaceController {
  constructor(
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly listings: ListingApplicationService,
  ) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const marketplaces = await this.marketplaceRepo.findByWorkspace(
      req.user!.workspaceId!,
    );
    ok(res, marketplaces.map(presentMarketplace));
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const marketplaceId = routeParam(req.params.id);
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      marketplaceId,
      req.user!.workspaceId!,
    );
    if (!marketplace) {
      return next(new NotFoundError(`Marketplace not found: ${marketplaceId}`));
    }
    ok(res, presentMarketplace(marketplace));
  };

  sync = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const marketplaceId = routeParam(req.params.id);
    // Confirm tenant ownership before enqueuing a sync for this marketplace (S2).
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      marketplaceId,
      req.user!.workspaceId!,
    );
    if (!marketplace) {
      return next(new NotFoundError(`Marketplace not found: ${marketplaceId}`));
    }
    const result = await this.listings.syncMarketplace({
      marketplaceId,
      actorId: req.user?.userId,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value, 202);
  };

  connect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const marketplaceId = routeParam(req.params.id);
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      marketplaceId,
      req.user!.workspaceId!,
    );
    if (!marketplace) {
      return next(new NotFoundError(`Marketplace not found: ${marketplaceId}`));
    }
    marketplace.connect();
    await this.marketplaceRepo.save(marketplace);
    ok(res, presentMarketplace(marketplace));
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const marketplaceId = routeParam(req.params.id);
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      marketplaceId,
      req.user!.workspaceId!,
    );
    if (!marketplace) {
      return next(new NotFoundError(`Marketplace not found: ${marketplaceId}`));
    }
    if (typeof req.body?.connected === 'boolean') {
      if (req.body.connected) marketplace.connect();
      else marketplace.disconnect();
    }
    if (typeof req.body?.syncMode === 'string') {
      const result = marketplace.setSyncMode(req.body.syncMode as SyncMode);
      if (result.isErr()) return next(result.error);
    }
    await this.marketplaceRepo.save(marketplace);
    ok(res, presentMarketplace(marketplace));
  };
}
