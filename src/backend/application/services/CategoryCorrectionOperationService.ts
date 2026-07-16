import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type {
  CategoryCorrectionOperation,
  ICategoryCorrectionOperationRepository,
} from '../../domain/repositories/interfaces/ICategoryCorrectionOperationRepository';
import type { IEventRepository } from '../../domain/repositories/interfaces/IEventRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IMarketplaceAdapter, PublishResult } from '../../domain/services/MarketplaceAdapter';
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
import type { HermesEventView } from '../dto/presenters';
import type {
  CategoryRecreationChangePayload,
  CategoryRecreationOperationAction,
  CategoryRecreationOperationStatus,
} from '../../../shared/types';

export interface CategoryCorrectionAdapterResolver {
  resolve(marketplace: Marketplace): Promise<IMarketplaceAdapter>;
}

export interface CategoryCorrectionPublishAttemptStore {
  begin(operationId: string, listingId: string, marketplaceKey: 'olx', listingUpdatedAt: Date): Promise<{
    created: boolean;
    checkpoint: {
      operationId: string;
      status: 'publishing' | 'published' | 'finalized' | 'abandoned';
      externalListingId: string | null;
      externalUrl: string | null;
      publishedAt: Date | null;
      remoteStatus: string | null;
    };
  }>;
  markPublished(operationId: string, result: PublishResult): Promise<void>;
  markFinalized(operationId: string): Promise<void>;
  markAbandoned(operationId: string): Promise<void>;
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
    private readonly publishAttempts: CategoryCorrectionPublishAttemptStore,
    now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  async list(recommendationEventId: string, workspaceId: string): Promise<CategoryCorrectionOperation[]> {
    const event = await this.events.findByIdForWorkspace(recommendationEventId, workspaceId);
    if (!event) throw new NotFoundError(`Hermes event not found: ${recommendationEventId}`);
    return this.operations.findByRecommendationForWorkspace(recommendationEventId, workspaceId);
  }

  async hydrateEvent(event: HermesEventView, workspaceId: string): Promise<HermesEventView> {
    const change = event.proposedChange;
    if (change?.kind !== 'category_recreation') return event;
    const durable = await this.operations.findByRecommendationForWorkspace(event.id, workspaceId);
    const delist = durable.find((operation) => operation.kind === 'delist');
    const recreate = durable.find((operation) => operation.kind === 'recreate');
    let recreateCanApprove = Boolean(recreate?.targetCategory);
    if (recreate?.state === 'requested') {
      const listing = await this.listings.findByIdForWorkspace(recreate.listingId, workspaceId);
      const product = listing
        ? await this.products.findByIdForWorkspace(listing.productId, workspaceId)
        : null;
      const target = recreate.targetCategory ?? listing?.marketplaceCategory ?? null;
      recreateCanApprove = Boolean(product && evaluateOlxCategory(product, target, this.now()).allowed);
    }
    return {
      ...event,
      proposedChange: {
        ...change,
        operations: [
          this.presentOperation(change.operations[0], delist, 'delist') as CategoryRecreationChangePayload['operations'][0],
          this.presentOperation(change.operations[1], recreate, 'recreate', recreateCanApprove) as CategoryRecreationChangePayload['operations'][1],
        ],
      },
    };
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
    let targetCategory = current.targetCategory ?? undefined;
    if (current.kind === 'recreate') {
      const listing = await this.listings.findByIdForWorkspace(current.listingId, input.workspaceId);
      if (!listing) throw new NotFoundError(`Listing not found: ${current.listingId}`);
      const product = await this.products.findByIdForWorkspace(listing.productId, input.workspaceId);
      if (!product) throw new NotFoundError(`Product not found: ${listing.productId}`);
      targetCategory = targetCategory ?? listing.marketplaceCategory ?? undefined;
      const categoryDecision = evaluateOlxCategory(product, targetCategory ?? null, this.now());
      if (!categoryDecision.allowed || !targetCategory) {
        throw new GuardrailViolationError(
          `Select and verify an exact OLX category before approving recreate: ${categoryDecision.reason}`,
          { categoryDecision },
        );
      }
    }
    const approved = await this.operations.approve({
      id: current.id,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      paidOverrideReason: input.paidOverrideReason?.trim(),
      targetCategory,
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
    if (current.kind === 'recreate') {
      const pair = await this.operations.findByRecommendationForWorkspace(
        current.recommendationEventId,
        input.workspaceId,
      );
      const delist = pair.find((candidate) => candidate.kind === 'delist');
      if (!delist || delist.state !== 'executed') {
        throw new InvalidStateError('Recreate cannot execute before the paired delist operation succeeds');
      }
    }
    const operation = await this.operations.claimApproved(current.id, input.workspaceId, this.now());
    if (!operation) {
      const raced = await this.requireOperation(current.id, input.workspaceId);
      if (raced.state === 'executed' || raced.state === 'failed') return raced;
      throw new InvalidStateError('Category correction operation is already executing');
    }

    let providerCheckpoint: Record<string, unknown> = {};
    let publicationReserved = false;
    let providerCallStarted = false;
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
        providerCheckpoint = {
          providerEffect: 'delisted',
          externalListingId: listing.marketplaceListingId,
        };
        const expired = listing.expire();
        if (expired.isErr()) throw expired.error;
        listing.recordSyncStatusNote('Remote advert delisted for category correction');
        await this.listings.save(listing);
        result = {
          externalListingId: listing.marketplaceListingId,
          quotaUnitsRestored: 0,
          deletionRestoresQuota: false,
        };
      } else {
        if (listing.status !== 'expired') {
          throw new InvalidStateError(`Recreate requires an expired listing; found ${listing.status}`);
        }
        const pair = await this.operations.findByRecommendationForWorkspace(
          operation.recommendationEventId,
          input.workspaceId,
        );
        const delist = pair.find((candidate) => candidate.kind === 'delist');
        const delistedExternalId = typeof delist?.result?.externalListingId === 'string'
          ? delist.result.externalListingId
          : null;
        if (!delistedExternalId || listing.marketplaceListingId !== delistedExternalId) {
          throw new InvalidStateError('Listing identity changed after delist; recreate requires a new review');
        }
        if (!operation.targetCategory) throw new InvalidStateError('Recreate requires an exact target category');
        const categoryDecision = evaluateOlxCategory(product, operation.targetCategory, this.now());
        if (!categoryDecision.allowed) {
          throw new GuardrailViolationError(`OLX target category blocks recreate: ${categoryDecision.reason}`, { categoryDecision });
        }
        const listingGeneration = listing.updatedAt;

        // Claim the cross-workflow publication fence before quota authorization.
        // A losing concurrent path must not consume a quota unit it cannot use.
        const started = await this.publishAttempts.begin(operation.id, listing.id, 'olx', listingGeneration);
        publicationReserved = started.created;
        let published: PublishResult | null = null;
        if (!started.created) {
          const checkpoint = started.checkpoint;
          if (checkpoint.operationId !== operation.id
            || !['published', 'finalized'].includes(checkpoint.status)
            || !checkpoint.externalListingId
            || !checkpoint.publishedAt) {
            throw new InvalidStateError('Another publication owns this listing generation; reconcile it before recreate');
          }
          published = {
            externalListingId: checkpoint.externalListingId,
            externalUrl: checkpoint.externalUrl,
            publishedAt: checkpoint.publishedAt,
            remoteStatus: checkpoint.remoteStatus,
          };
          providerCheckpoint = {
            providerEffect: 'published',
            externalListingId: checkpoint.externalListingId,
            externalUrl: checkpoint.externalUrl,
            publishedAt: checkpoint.publishedAt.toISOString(),
          };
        } else {
          const fencedListing = await this.listings.findByIdForWorkspace(operation.listingId, input.workspaceId);
          if (!fencedListing
            || fencedListing.status !== 'expired'
            || fencedListing.marketplaceListingId !== delistedExternalId
            || fencedListing.updatedAt.getTime() !== listingGeneration.getTime()) {
            throw new InvalidStateError('Listing changed while recreate publication was being reserved');
          }
        }

        const quotaDecision = await this.quota.authorize({
          operationId: operation.id,
          mode: 'recreate',
          listing,
          product,
          marketplace,
          marketplaceCategory: operation.targetCategory,
          actorId: input.actorId,
          ...(operation.paidOverrideReason
            ? { override: { confirmed: true as const, reason: operation.paidOverrideReason } }
            : {}),
        });
        if (quotaDecision.decision !== 'allow' && quotaDecision.decision !== 'override') {
          throw this.quota.guardError(quotaDecision);
        }

        if (started.created) {
          const adapter = await this.adapters.resolve(marketplace);
          providerCallStarted = true;
          published = await adapter.publish({
            productName: product.name,
            description: product.description,
            price: listing.price.amount,
            currency: listing.price.currency,
            category: product.category,
            marketplaceCategory: operation.targetCategory,
            condition: product.condition,
            imageUrls: [...product.images],
          });
          await this.publishAttempts.markPublished(operation.id, published);
          publicationReserved = false;
        }
        if (!published) throw new InvalidStateError('Publication checkpoint did not produce a provider identity');
        listing.recordMarketplaceCategory(operation.targetCategory);
        providerCheckpoint = {
          providerEffect: 'published',
          externalListingId: published.externalListingId,
          externalUrl: published.externalUrl ?? null,
          publishedAt: published.publishedAt.toISOString(),
        };
        const linked = listing.publish(
          product,
          marketplace,
          published.externalListingId,
          published.externalUrl ?? null,
          published.publishedAt,
          null,
          published.remoteStatus ?? null,
        );
        if (linked.isErr()) throw linked.error;
        await this.listings.save(listing);
        await this.publishAttempts.markFinalized(operation.id);
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
      if (publicationReserved && !providerCallStarted) {
        try {
          await this.publishAttempts.markAbandoned(operation.id);
          publicationReserved = false;
        } catch {
          providerCheckpoint = { publicationFenceReleaseFailed: true };
        }
      }
      const quotaDecision = error instanceof GuardrailViolationError
        ? error.details?.quotaDecision
        : undefined;
      if (quotaDecision && Object.keys(providerCheckpoint).length === 0) {
        const blocked = {
          quotaDecision,
          retrySafe: true,
          manualReconciliationRequired: false,
        };
        const released = await this.operations.releaseToApproved(
          operation.id,
          input.workspaceId,
          blocked,
          this.now(),
        );
        if (released) {
          await this.audit(released, input.actorId, 'olx.category_correction.blocked', blocked);
        }
        throw error;
      }
      const failure = {
        errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'DEPENDENCY_FAILURE',
        message: error instanceof Error ? error.message : 'Unknown category correction failure',
        retrySafe: false,
        manualReconciliationRequired: true,
        ...providerCheckpoint,
      };
      const failed = await this.operations.markFailed(operation.id, input.workspaceId, failure, this.now());
      if (failed) await this.audit(failed, input.actorId, 'olx.category_correction.failed', failure);
      throw error;
    }
  }

  private presentOperation(
    fallback: CategoryRecreationChangePayload['operations'][number],
    operation: CategoryCorrectionOperation | undefined,
    kind: 'delist' | 'recreate',
    canApprove = true,
  ): CategoryRecreationChangePayload['operations'][number] {
    if (!operation) return { ...fallback, availableActions: [] };
    const statusByState: Record<CategoryCorrectionOperation['state'], CategoryRecreationOperationStatus> = {
      requested: kind === 'recreate' && !operation.targetCategory
        ? 'blocked_pending_quota_review'
        : 'pending_review',
      approved: 'approved',
      executing: 'running',
      executed: 'succeeded',
      failed: 'failed',
    };
    const action = (actionKind: 'approve' | 'execute'): CategoryRecreationOperationAction => actionKind === 'approve'
      ? {
          kind: 'approve', method: 'POST',
          href: `/hermes/category-correction-operations/${operation.id}/approve`,
          label: `Review ${kind}`,
        }
      : {
          kind: 'execute', method: 'POST',
          href: `/hermes/category-correction-operations/${operation.id}/execute`,
          label: `Execute ${kind}`,
        };
    const availableActions = operation.state === 'requested' && canApprove
      ? [action('approve')]
      : operation.state === 'approved'
        ? [action('execute')]
        : [];
    const failureReason = operation.state === 'failed' && typeof operation.result?.message === 'string'
      ? operation.result.message
      : undefined;
    if (kind === 'delist') {
      return {
        kind,
        intentId: operation.id,
        status: statusByState[operation.state],
        providerSideEffectAllowed: operation.state === 'approved',
        quotaUnitsRestored: 0,
        availableActions,
        failureReason,
      };
    }
    const quotaDecision = operation.result?.quotaDecision as Record<string, unknown> | undefined;
    return {
      kind,
      intentId: operation.id,
      status: statusByState[operation.state],
      providerSideEffectAllowed: operation.state === 'approved',
      quotaGuardRequired: true,
      availableActions,
      failureReason,
      ...(quotaDecision ? {
        quota: {
          status: String(quotaDecision.status ?? 'unknown') as 'available' | 'unknown' | 'stale' | 'exhausted' | 'paid_risk',
          remaining: typeof quotaDecision.remaining === 'number' ? quotaDecision.remaining : null,
          paidRisk: quotaDecision.decision === 'override',
          reason: typeof quotaDecision.reason === 'string' ? quotaDecision.reason : undefined,
        },
      } : {}),
    };
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
