import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type {
  CategoryCorrectionOperation,
  ICategoryCorrectionOperationRepository,
} from '../../domain/repositories/interfaces/ICategoryCorrectionOperationRepository';
import type { IEventRepository } from '../../domain/repositories/interfaces/IEventRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IMarketplaceAdapter } from '../../domain/services/MarketplaceAdapter';
import { evaluateOlxCategory } from '../../domain/services/OlxCategoryGuard';
import {
  GuardrailViolationError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../../domain/shared/DomainError';
import type { IdGenerator } from '../ports/IdGenerator';
import type { OlxPublicationQuotaService } from './OlxPublicationQuotaService';
import type { Marketplace } from '../../domain/entities/Marketplace';

export interface CategoryCorrectionAdapterResolver {
  resolve(marketplace: Marketplace): Promise<IMarketplaceAdapter>;
}

export class CategoryCorrectionOperationService {
  private readonly now: () => Date;

  constructor(
    private readonly operations: ICategoryCorrectionOperationRepository,
    private readonly events: IEventRepository,
    private readonly listings: IListingRepository,
    private readonly products: IProductRepository,
    private readonly marketplaces: IMarketplaceRepository,
    private readonly quota: OlxPublicationQuotaService,
    private readonly adapters: CategoryCorrectionAdapterResolver,
    private readonly activity: IActivityLogRepository,
    private readonly idGenerator: IdGenerator,
    now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  async list(recommendationEventId: string, workspaceId: string): Promise<CategoryCorrectionOperation[]> {
    const event = await this.events.findByIdForWorkspace(recommendationEventId, workspaceId);
    if (!event) throw new NotFoundError(`Hermes event not found: ${recommendationEventId}`);
    return this.operations.findByRecommendationForWorkspace(recommendationEventId, workspaceId);
  }

  async approve(input: {
    operationId: string;
    workspaceId: string;
    actorId: string;
    paidOverrideReason?: string;
  }): Promise<CategoryCorrectionOperation> {
    if (!input.actorId.trim()) throw new ValidationError('Authenticated actor is required');
    const current = await this.requireOperation(input.operationId, input.workspaceId);
    if (input.paidOverrideReason !== undefined) {
      if (current.kind !== 'recreate') throw new ValidationError('Paid-risk override is only valid for recreate');
      if (input.paidOverrideReason.trim().length < 10) {
        throw new ValidationError('Paid-risk override reason must be at least 10 characters');
      }
    }
    if (current.state !== 'requested') {
      if (current.state === 'approved' && current.approvedBy === input.actorId
        && current.paidOverrideReason === (input.paidOverrideReason?.trim() ?? null)) return current;
      throw new InvalidStateError(`Cannot approve category correction operation from ${current.state}`);
    }
    const approved = await this.operations.approve({
      id: current.id,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      paidOverrideReason: input.paidOverrideReason?.trim(),
      at: this.now(),
    });
    if (!approved || approved.state !== 'approved'
      || approved.approvedBy !== input.actorId
      || approved.paidOverrideReason !== (input.paidOverrideReason?.trim() ?? null)) {
      throw new InvalidStateError('Category correction operation was concurrently changed');
    }
    await this.audit(approved, input.actorId, 'olx.category_correction.approved', {
      paidRiskOverride: approved.paidOverrideReason !== null,
      overrideReason: approved.paidOverrideReason,
    });
    return approved;
  }

  async execute(input: { operationId: string; workspaceId: string; actorId: string }): Promise<CategoryCorrectionOperation> {
    if (!input.actorId.trim()) throw new ValidationError('Authenticated actor is required');
    const current = await this.requireOperation(input.operationId, input.workspaceId);
    if (current.state === 'executed' || current.state === 'failed') return current;
    if (current.state !== 'approved') {
      throw new InvalidStateError(
        current.state === 'executing'
          ? 'Operation is already executing or requires manual reconciliation after an interrupted effect'
          : `Cannot execute category correction operation from ${current.state}`,
      );
    }
    const operation = await this.operations.claimApproved(current.id, input.workspaceId, this.now());
    if (!operation) {
      const raced = await this.requireOperation(current.id, input.workspaceId);
      if (raced.state === 'executed' || raced.state === 'failed') return raced;
      throw new InvalidStateError('Category correction operation is already executing');
    }

    try {
      await this.audit(operation, input.actorId, 'olx.category_correction.executing', {});
      const listing = await this.listings.findByIdForWorkspace(operation.listingId, input.workspaceId);
      if (!listing) throw new NotFoundError(`Listing not found: ${operation.listingId}`);
      const product = await this.products.findByIdForWorkspace(listing.productId, input.workspaceId);
      if (!product) throw new NotFoundError(`Product not found: ${listing.productId}`);
      const marketplace = await this.marketplaces.findByIdForWorkspace(operation.marketplaceId, input.workspaceId);
      if (!marketplace) throw new NotFoundError(`Marketplace not found: ${operation.marketplaceId}`);
      if (marketplace.key !== 'olx') throw new InvalidStateError('Category correction operations are only supported for OLX');
      let result: Record<string, unknown>;
      if (operation.kind === 'delist') {
        if (!listing.marketplaceListingId) throw new InvalidStateError('Delist requires an external listing id');
        const adapter = await this.adapters.resolve(marketplace);
        await adapter.delist(listing.marketplaceListingId);
        result = {
          externalListingId: listing.marketplaceListingId,
          quotaUnitsRestored: 0,
          deletionRestoresQuota: false,
        };
      } else {
        if (!operation.targetCategory) throw new InvalidStateError('Recreate requires an exact target category');
        const categoryDecision = evaluateOlxCategory(product, operation.targetCategory, this.now());
        if (!categoryDecision.allowed) {
          throw new GuardrailViolationError(`OLX target category blocks recreate: ${categoryDecision.reason}`, { categoryDecision });
        }
        listing.recordMarketplaceCategory(operation.targetCategory);
        // Authorization is deliberately the final step before the provider POST.
        const quotaDecision = await this.quota.authorize({
          operationId: operation.id,
          mode: 'recreate',
          listing,
          product,
          marketplace,
          actorId: input.actorId,
          ...(operation.paidOverrideReason
            ? { override: { confirmed: true as const, reason: operation.paidOverrideReason } }
            : {}),
        });
        if (quotaDecision.decision !== 'allow' && quotaDecision.decision !== 'override') {
          throw this.quota.guardError(quotaDecision);
        }
        // Resolve/refresh authenticated provider access only after quota has allowed
        // this exact recreate operation; even auth transport work stays behind the gate.
        const adapter = await this.adapters.resolve(marketplace);
        const published = await adapter.publish({
          productName: product.name,
          description: product.description,
          price: listing.price.amount,
          currency: listing.price.currency,
          category: product.category,
          marketplaceCategory: operation.targetCategory,
          condition: product.condition,
          imageUrls: [...product.images],
        });
        result = {
          externalListingId: published.externalListingId,
          externalUrl: published.externalUrl ?? null,
          publishedAt: published.publishedAt.toISOString(),
          remoteStatus: published.remoteStatus ?? null,
          quotaDecision,
        };
      }

      const executed = await this.operations.markExecuted(operation.id, input.workspaceId, result, this.now());
      if (!executed || executed.state !== 'executed') throw new InvalidStateError('Operation result could not be persisted');
      await this.audit(executed, input.actorId, 'olx.category_correction.executed', result);
      return executed;
    } catch (error) {
      const failure = {
        errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'DEPENDENCY_FAILURE',
        message: error instanceof Error ? error.message : 'Unknown category correction failure',
        retrySafe: false,
        manualReconciliationRequired: true,
      };
      const failed = await this.operations.markFailed(operation.id, input.workspaceId, failure, this.now());
      if (failed) await this.audit(failed, input.actorId, 'olx.category_correction.failed', failure);
      throw error;
    }
  }

  private async requireOperation(id: string, workspaceId: string): Promise<CategoryCorrectionOperation> {
    const operation = await this.operations.findByIdForWorkspace(id, workspaceId);
    if (!operation) throw new NotFoundError(`Category correction operation not found: ${id}`);
    return operation;
  }

  private async audit(
    operation: CategoryCorrectionOperation,
    actorId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.activity.record({
      id: this.idGenerator(), workspaceId: operation.workspaceId, entityType: 'listing',
      entityId: operation.listingId, actorType: 'user', actorId, action,
      metadata: { operationId: operation.id, recommendationEventId: operation.recommendationEventId,
        kind: operation.kind, state: operation.state, ...metadata }, createdAt: this.now(),
    });
  }
}
