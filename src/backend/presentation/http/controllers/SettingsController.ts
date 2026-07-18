import type { Request, Response, NextFunction } from 'express';
import type { ISettingsRepository } from '../../../application/ports/ISettingsRepository';
import type { IWorkspaceRepository } from '../../../domain/repositories/interfaces/IWorkspaceRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { MarketplaceOAuthService } from '../../../application/services/MarketplaceOAuthService';
import { Workspace } from '../../../domain/entities/Workspace';
import { NotFoundError } from '../../../domain/shared/DomainError';
import type {
  AutonomyLevel,
  HermesGuardrails,
  IntegrationSettingsStatus,
  WorkspaceLanguage,
} from '../../../../shared/types';
import { ok } from '../formatters/ResponseFormatter';

export class SettingsController {
  constructor(
    private readonly workspaces: IWorkspaceRepository,
    private readonly settings: ISettingsRepository,
    private readonly marketplaces: IMarketplaceRepository,
    private readonly oauth: MarketplaceOAuthService
  ) {}

  private async workspace(workspaceId: string) {
    const workspace = await this.workspaces.findById(workspaceId);
    if (!workspace) throw new NotFoundError(`Workspace not found: ${workspaceId}`);
    return workspace;
  }

  getWorkspace = async (req: Request, res: Response): Promise<void> => {
    const workspace = await this.workspace(req.user!.workspaceId!);
    ok(res, {
      id: workspace.id,
      name: workspace.name,
      currency: workspace.currency,
      timezone: workspace.timezone,
      language: workspace.language,
      updatedAt: workspace.updatedAt.toISOString(),
    });
  };

  updateWorkspace = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const current = await this.workspace(req.user!.workspaceId!);
    const rebuilt = Workspace.create({
      id: current.id,
      name: req.body.name ?? current.name,
      currency: req.body.currency ?? current.currency,
      timezone: req.body.timezone ?? current.timezone,
      language: (req.body.language ?? current.language) as WorkspaceLanguage,
      autonomyLevel: current.autonomyLevel,
      guardrails: current.guardrails,
      createdAt: current.createdAt,
    });
    if (rebuilt.isErr()) return next(rebuilt.error);
    const updated = await this.workspaces.updateProfile(current.id, {
      name: req.body.name,
      currency: req.body.currency,
      timezone: req.body.timezone,
      language: req.body.language,
    });
    if (!updated) throw new NotFoundError(`Workspace not found: ${current.id}`);
    ok(res, {
      id: updated.id,
      name: updated.name,
      currency: updated.currency,
      timezone: updated.timezone,
      language: updated.language,
      updatedAt: updated.updatedAt.toISOString(),
    });
  };

  getPreferences = async (req: Request, res: Response): Promise<void> => {
    ok(res, await this.settings.getUserPreferences(req.user!.workspaceId!, req.user!.userId));
  };

  updatePreferences = async (req: Request, res: Response): Promise<void> => {
    ok(
      res,
      await this.settings.updateUserPreferences(req.user!.workspaceId!, req.user!.userId, req.body)
    );
  };

  getNotifications = async (req: Request, res: Response): Promise<void> => {
    ok(
      res,
      await this.settings.getNotificationPreferences(req.user!.workspaceId!, req.user!.userId)
    );
  };

  updateNotifications = async (req: Request, res: Response): Promise<void> => {
    ok(
      res,
      await this.settings.updateNotificationPreferences(
        req.user!.workspaceId!,
        req.user!.userId,
        req.body
      )
    );
  };

  getHermes = async (req: Request, res: Response): Promise<void> => {
    const workspace = await this.workspace(req.user!.workspaceId!);
    ok(res, {
      autonomyLevel: workspace.autonomyLevel,
      guardrails: workspace.guardrails,
      updatedAt: workspace.updatedAt.toISOString(),
    });
  };

  updateHermes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const current = await this.workspace(req.user!.workspaceId!);
    const rebuilt = Workspace.create({
      id: current.id,
      name: current.name,
      currency: current.currency,
      timezone: current.timezone,
      language: current.language,
      autonomyLevel: (req.body.autonomyLevel ?? current.autonomyLevel) as AutonomyLevel,
      guardrails: {
        ...current.guardrails,
        ...(req.body.guardrails as Partial<HermesGuardrails> | undefined),
      },
      createdAt: current.createdAt,
    });
    if (rebuilt.isErr()) return next(rebuilt.error);
    const guardrailResult = rebuilt.value.updateGuardrails({});
    if (guardrailResult.isErr()) return next(guardrailResult.error);
    const updated = await this.workspaces.updateHermes(current.id, {
      autonomyLevel: req.body.autonomyLevel,
      guardrails: req.body.guardrails,
    });
    if (!updated) throw new NotFoundError(`Workspace not found: ${current.id}`);
    ok(res, {
      autonomyLevel: updated.autonomyLevel,
      guardrails: updated.guardrails,
      updatedAt: updated.updatedAt.toISOString(),
    });
  };

  getIntegrations = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.user!.workspaceId!;
    const marketplaces = await this.marketplaces.findByWorkspace(workspaceId);
    const marketplaceItems: IntegrationSettingsStatus[] = await Promise.all(
      marketplaces.map(async (marketplace) => {
        let configured = false;
        if (marketplace.key === 'olx' && typeof this.oauth.getAppCredentialStatus === 'function') {
          const status = await this.oauth.getAppCredentialStatus({
            marketplaceId: marketplace.id,
            workspaceId,
          });
          configured = status.configured;
        }
        return {
          category: 'marketplace' as const,
          id: marketplace.id,
          providerKey: marketplace.key,
          name: marketplace.name,
          available: marketplace.key === 'olx',
          configured,
        };
      })
    );
    const apiKeySummary = await this.settings.getApiKeySummary(workspaceId);
    const items: IntegrationSettingsStatus[] = [
      ...marketplaceItems,
      {
        category: 'telegram',
        id: 'telegram',
        name: 'Telegram',
        available: false,
        configured: false,
      },
      {
        category: 'api_keys',
        id: 'api_keys',
        name: 'API keys',
        available: true,
        configured: apiKeySummary.active > 0,
        apiKeySummary,
      },
    ];
    ok(res, { items });
  };
}
