// Thin HTTP adapter for marketplace resources. Reads and simple connection/sync-mode
// transitions run against the injected repository (no marketplace application service
// exists yet); the async sync enqueue delegates to ListingApplicationService.

import type { Request, Response, NextFunction } from 'express';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { ListingApplicationService } from '../../../application/services/ListingApplicationService';
import type { MarketplaceOAuthService } from '../../../application/services/MarketplaceOAuthService';
import type { MarketplaceSyncScheduler } from '../../../application/services/MarketplaceSyncScheduler';
import type { MarketplaceImportService } from '../../../application/services/MarketplaceImportService';
import type { SyncMode } from '../../../../shared/types';
import { DomainError, InvalidStateError, NotFoundError } from '../../../domain/shared/DomainError';
import { presentMarketplace } from '../../../application/dto/presenters';
import { ok } from '../formatters/ResponseFormatter';
import type { ErrorLogger } from '../middleware/ErrorHandlingMiddleware';


function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export class MarketplaceController {
  constructor(
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly listings: ListingApplicationService,
    private readonly oauth: MarketplaceOAuthService,
    private readonly syncScheduler: MarketplaceSyncScheduler,
    private readonly imports: MarketplaceImportService,
    private readonly oauthReturnUrl: string,
    private readonly logger?: ErrorLogger,
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
      workspaceId: req.user!.workspaceId!,
      actorId: req.user?.userId,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value, 202);
  };

  connect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const marketplaceId = routeParam(req.params.id);
    const result = await this.oauth.start({
      marketplaceId,
      workspaceId: req.user!.workspaceId!,
    });
    ok(res, result);
  };

  callback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const providerKey = routeParam(req.params.provider);
    const code = routeParam(req.query.code as string | string[] | undefined);
    const state = routeParam(req.query.state as string | string[] | undefined);
    const wantsJson =
      req.query.response === 'json' ||
      (req.get('accept') ?? '').toLowerCase().includes('application/json');

    try {
      const result = await this.oauth.complete({ providerKey, code, state });
      if (wantsJson) {
        ok(res, result);
        return;
      }
      const target = new URL(this.oauthReturnUrl);
      target.searchParams.set('oauth', 'success');
      target.searchParams.set('marketplaceId', result.marketplaceId);
      res.redirect(303, target.toString());
    } catch (error) {
      if (wantsJson) return next(error);
      this.logger?.error({ error }, 'OLX OAuth callback failed');
      try {
        const target = new URL(this.oauthReturnUrl);
        target.searchParams.set('oauth', 'error');
        target.searchParams.set(
          'code',
          error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
        );
        res.redirect(303, target.toString());
      } catch {
        next(error);
      }
    }
  };

  check = async (req: Request, res: Response): Promise<void> => {
    const result = await this.oauth.check({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
    });
    ok(res, result);
  };

  getAppCredentials = async (req: Request, res: Response): Promise<void> => {
    const result = await this.oauth.getAppCredentialStatus({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
    });
    ok(res, result);
  };

  saveAppCredentials = async (req: Request, res: Response): Promise<void> => {
    const result = await this.oauth.saveAppCredentials({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
      clientId: typeof req.body?.clientId === 'string' ? req.body.clientId : '',
      clientSecret: typeof req.body?.clientSecret === 'string' ? req.body.clientSecret : '',
    });
    ok(res, result);
  };

  removeAppCredentials = async (req: Request, res: Response): Promise<void> => {
    const result = await this.oauth.removeAppCredentials({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
    });
    ok(res, result);
  };

  importPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await this.imports.preview({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
      pageSize: req.body?.pageSize,
      statuses: req.body?.statuses,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  importApply = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await this.imports.import({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
      pageSize: req.body?.pageSize,
      statuses: req.body?.statuses,
      externalListingIds: Array.isArray(req.body?.externalListingIds)
        ? req.body.externalListingIds
        : undefined,
      actorId: req.user?.userId,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value, 201);
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
      if (req.body.connected) {
        if (marketplace.key === 'olx' && !marketplace.isConnected()) {
          return next(
            new InvalidStateError('Use POST /marketplaces/:id/connect to authorize with OAuth'),
          );
        }
        marketplace.connect();
      }
      if (!req.body.connected) {
        if (marketplace.key === 'olx') {
          await this.oauth.disconnect({
            marketplaceId,
            workspaceId: req.user!.workspaceId!,
          });
        }
        marketplace.disconnect();
      }
    }
    if (typeof req.body?.syncMode === 'string') {
      const result = marketplace.setSyncMode(req.body.syncMode as SyncMode);
      if (result.isErr()) return next(result.error);
    }
    try {
      await this.syncScheduler.reconcile(marketplace);
    } catch (error) {
      return next(error);
    }
    await this.marketplaceRepo.save(marketplace);
    ok(res, presentMarketplace(marketplace));
  };
}
