// Use case: approve a pending Hermes event and apply its proposed change
// (ARCHITECTURE.md §10 apply semantics).
//   - The event MUST be in pending_review (rejected otherwise).
//   - price/title/description changes mutate the product aggregate.
//   - price changes additionally append a PriceHistory record per affected listing.
//   - relist changes enqueue publish jobs for the referenced listings.
//   - every approval records an ActivityLog entry, marks the event applied, and
//     emits a domain event.

import { Result, Ok, Err } from '../../domain/shared/Result';
import {
  GuardrailViolationError,
  NotFoundError,
  InvalidStateError,
  ServiceUnavailableError,
} from '../../domain/shared/DomainError';
import { Money } from '../../domain/valueObjects/Money';
import type { HermesEvent } from '../../domain/entities/HermesEvent';
import type { Listing } from '../../domain/entities/Listing';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type { Product } from '../../domain/entities/Product';
import type { ProposedChange } from '../../../shared/types';
import type { IEventRepository } from '../../domain/repositories/interfaces/IEventRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IEventPublisher, DomainEvent } from '../../domain/ports/IEventPublisher';
import type { IPriceHistoryRecorder } from '../ports/IPriceHistoryRecorder';
import type { IJobQueue, PublishListingJob, ListingUpdateJobChanges } from '../ports/IJobQueue';
import type { IdGenerator } from '../ports/IdGenerator';
import type { ApproveEventDTO } from '../dto/ApproveEventDTO';
import type { MarketplaceAccountRepository } from '../services/MarketplaceOAuthService';
import type { OlxPublicationQuotaService } from '../services/OlxPublicationQuotaService';
import {
  listingSeoProfile,
  seoSourceFingerprint,
  type AgentRecommendationRecord,
} from '../../domain/agents/MarketDeskAgentCatalog';

interface MarketplaceUpdateOperation {
  operationId: string;
  listingId: string;
  marketplaceId: string;
}

interface ApplyChangeOutcome {
  marketplaceUpdates: MarketplaceUpdateOperation[];
  skippedLiveListings?: Array<{ listingId: string; reason: string }>;
}

type MarketplaceUpdateChanges = ListingUpdateJobChanges;

interface EnqueueMarketplaceUpdateOptions {
  requireAllLiveTargets?: boolean;
}

export class ApproveHermesEventUseCase {
  constructor(
    private readonly eventRepo: IEventRepository,
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly activityLog: IActivityLogRepository,
    private readonly priceHistory: IPriceHistoryRecorder,
    private readonly publishQueue: IJobQueue<PublishListingJob>,
    private readonly eventPublisher: IEventPublisher,
    private readonly idGenerator: IdGenerator,
    private readonly marketplaceAccountRepo?: MarketplaceAccountRepository,
    private readonly olxQuota?: OlxPublicationQuotaService
  ) {}

  async execute(input: ApproveEventDTO): Promise<Result<HermesEvent>> {
    // Tenant-scoped load: reject events belonging to another workspace (S2).
    const event = await this.eventRepo.findByIdForWorkspace(input.eventId, input.workspaceId);
    if (!event) {
      return Err(new NotFoundError(`Hermes event not found: ${input.eventId}`));
    }

    if (event.status !== 'pending_review') {
      const reconciled = await this.reconcileAppliedListingSeoNoop(event, input.actorId);
      if (reconciled) return reconciled;
      return Err(
        new InvalidStateError(
          `Cannot approve event in ${event.status} state (must be pending_review)`
        )
      );
    }

    if (event.proposedChange?.kind === 'category_recreation') {
      await this.activityLog.record({
        id: this.idGenerator(),
        workspaceId: event.workspaceId,
        entityType: 'hermes_event',
        entityId: event.id,
        actorType: 'user',
        actorId: input.actorId,
        action: 'olx.category_recreation_combined_approval_refused',
        metadata: {
          listingId: event.proposedChange.listingId,
          operations: event.proposedChange.operations,
          reason: 'delist_and_recreate_require_separate_reviewed_execution',
        },
        createdAt: new Date(),
      });
      return Err(
        new InvalidStateError(
          'Category correction cannot be approved as one operation; delist and quota-guarded recreate remain separate pending-review intents'
        )
      );
    }

    const approved = event.approve();
    if (approved.isErr()) return approved;

    let applied: Result<ApplyChangeOutcome>;
    try {
      await this.eventRepo.save(event);
      await this.eventRepo.markAgentRecommendationApproved(event.workspaceId, event.id, new Date());
      applied = await this.applyChange(event, input.actorId);
    } catch (error) {
      const failed = event.markFailed();
      if (failed.isOk()) {
        await this.eventRepo.save(event);
        await this.eventRepo.markAgentRecommendationFailed(
          event.workspaceId,
          event.id,
          event.resolvedAt ?? new Date()
        );
      }
      throw error;
    }
    if (applied.isErr()) {
      const failed = event.markFailed();
      if (failed.isOk()) {
        await this.eventRepo.save(event);
        await this.eventRepo.markAgentRecommendationFailed(
          event.workspaceId,
          event.id,
          event.resolvedAt ?? new Date()
        );
      }
      return applied;
    }

    const completed = event.markApplied();
    if (completed.isErr()) return completed;
    await this.eventRepo.save(event);
    await this.eventRepo.markAgentRecommendationApplied(
      event.workspaceId,
      event.id,
      event.resolvedAt ?? new Date()
    );

    await this.activityLog.record({
      id: this.idGenerator(),
      workspaceId: event.workspaceId,
      entityType: 'hermes_event',
      entityId: event.id,
      actorType: 'user',
      actorId: input.actorId,
      action: 'hermes_event.approved',
      metadata: {
        eventType: event.type,
        proposedChange: event.proposedChange as unknown as Record<string, unknown> | null,
        marketplaceSync:
          applied.value.marketplaceUpdates.length > 0
            ? {
                status: 'queued',
                operations: applied.value.marketplaceUpdates,
              }
            : (applied.value.skippedLiveListings?.length ?? 0) > 0
              ? {
                  status: 'retry_required',
                  skippedLiveListings: applied.value.skippedLiveListings,
                }
              : { status: 'not_required' },
      },
      createdAt: event.resolvedAt ?? new Date(),
    });

    await this.eventPublisher.publish(this.appliedEvent(event));

    return Ok(event);
  }

  private async applyChange(
    event: HermesEvent,
    actorId?: string
  ): Promise<Result<ApplyChangeOutcome>> {
    const change = event.proposedChange;
    if (change === null) {
      return Err(new InvalidStateError('Events without a proposed change cannot be applied'));
    }

    switch (change.kind) {
      case 'price':
        return this.applyPriceChange(event, change);
      case 'title':
      case 'description':
        return this.applyProductTextChange(event, change);
      case 'relist':
        // Enqueues an actual republish job per referenced listing (real action).
        return this.applyRelist(change.listingIds, actorId);
      case 'create_listing':
        // There is no synchronous listing-creation flow wired, so approving a
        // create_listing event cannot actually create the listing. Reject rather
        // than mark it `applied` for a no-op (C6). The listing must be created
        // manually / via the publish flow.
        return Err(
          new InvalidStateError(
            'create_listing events cannot be applied automatically; create the listing via the publish flow'
          )
        );
      case 'category_recreation':
        return Err(
          new InvalidStateError(
            'Category correction cannot be applied as one operation; review and execute the audited delist and quota-guarded recreate intents separately'
          )
        );
      default:
        return Ok({ marketplaceUpdates: [] });
    }
  }

  private async findListingSeoRecommendation(
    event: HermesEvent
  ): Promise<AgentRecommendationRecord | null> {
    if (event.proposedChange?.kind !== 'title' && event.proposedChange?.kind !== 'description') {
      return null;
    }
    const recommendation = await this.eventRepo.findAgentRecommendationByEvent(
      event.workspaceId,
      event.id
    );
    return recommendation?.agentId === listingSeoProfile.id ? recommendation : null;
  }

  private async reconcileAppliedListingSeoNoop(
    event: HermesEvent,
    actorId?: string
  ): Promise<Result<HermesEvent> | null> {
    if (event.status !== 'applied') return null;
    const change = event.proposedChange;
    if (change?.kind !== 'title' && change?.kind !== 'description') return null;
    const recommendation = await this.findListingSeoRecommendation(event);
    if (!recommendation?.appliedAt) return null;

    const product = await this.requireProduct(event.productId);
    if (product.isErr()) return product;
    const currentValue = change.kind === 'title' ? product.value.name : product.value.description;
    if (currentValue !== change.from) return null;

    const listings = await this.listingRepo.findByProduct(product.value.id);
    const sourceStillMatches = [null, ...listings].some(
      (listing) =>
        this.listingSeoSourceFor(product.value, listing) === recommendation.sourceFingerprint
    );
    if (!sourceStillMatches) return null;

    const replayTargetsReady = await this.ensureListingSeoReplayTargetsReady(event, listings);
    if (replayTargetsReady.isErr()) return replayTargetsReady;

    const rollbackValue = currentValue;
    let applied: Result<ApplyChangeOutcome>;
    try {
      applied = await this.applyChange(event, actorId);
    } catch (error) {
      await this.restoreOrRecordListingSeoRollbackFailure(
        event,
        product.value,
        change,
        rollbackValue,
        'queue_acceptance_failed'
      );
      await this.recordListingSeoReconciliationFailure(event, 'queue_acceptance_failed');
      throw error;
    }
    if (applied.isErr()) {
      const restored = await this.restoreOrRecordListingSeoRollbackFailure(
        event,
        product.value,
        change,
        rollbackValue,
        'apply_failed'
      );
      await this.recordListingSeoReconciliationFailure(event, 'apply_failed');
      if (restored.isErr()) return restored;
      return applied;
    }
    if (
      applied.value.marketplaceUpdates.length === 0 &&
      listings.some((listing) => this.isListingSeoLiveTarget(listing))
    ) {
      const restored = await this.restoreOrRecordListingSeoRollbackFailure(
        event,
        product.value,
        change,
        rollbackValue,
        'missing_live_listing_update'
      );
      await this.recordListingSeoReconciliationFailure(event, 'missing_live_listing_update');
      if (restored.isErr()) return restored;
      return Err(
        new InvalidStateError(
          'Listing SEO reconciliation requires a queued marketplace update for live listings'
        )
      );
    }

    await this.activityLog.record({
      id: this.idGenerator(),
      workspaceId: event.workspaceId,
      entityType: 'hermes_event',
      entityId: event.id,
      actorType: 'user',
      actorId,
      action: 'hermes_event.reconciled',
      metadata: {
        eventType: event.type,
        proposedChange: event.proposedChange as unknown as Record<string, unknown> | null,
        marketplaceSync:
          applied.value.marketplaceUpdates.length > 0
            ? { status: 'queued', operations: applied.value.marketplaceUpdates }
            : { status: 'not_required' },
        reason: 'legacy_listing_seo_noop_applied_replay',
      },
      createdAt: new Date(),
    });
    return Ok(event);
  }

  private async ensureListingSeoReplayTargetsReady(
    event: HermesEvent,
    listings: Listing[]
  ): Promise<Result<void>> {
    for (const listing of listings) {
      if (!this.isListingSeoLiveTarget(listing)) continue;
      const marketplace = await this.marketplaceRepo.findById(listing.marketplaceId);
      if (!marketplace || !marketplace.isConnected()) {
        await this.recordListingSeoReconciliationFailure(event, 'marketplace_not_connected');
        return Err(
          new InvalidStateError(
            'Listing SEO reconciliation requires connected marketplace for live listing replay'
          )
        );
      }
      if (this.marketplaceAccountRepo) {
        const account = await this.marketplaceAccountRepo.findByMarketplaceId(marketplace.id);
        if (!account || account.status !== 'connected') {
          await this.recordListingSeoReconciliationFailure(
            event,
            'marketplace_account_not_connected'
          );
          return Err(
            new InvalidStateError(
              'Listing SEO reconciliation requires connected marketplace account for live listing replay'
            )
          );
        }
      }
    }
    return Ok(undefined);
  }

  private isListingSeoLiveTarget(listing: Listing): boolean {
    return listing.isLive() && Boolean(listing.marketplaceListingId);
  }

  private async restoreListingSeoProductValue(
    product: Product,
    change: Extract<ProposedChange, { kind: 'title' | 'description' }>,
    value: string
  ): Promise<Result<void>> {
    const restored =
      change.kind === 'title' ? product.rename(value) : product.updateDescription(value);
    if (restored.isErr()) return restored;
    try {
      await this.productRepo.save(product);
      return Ok(undefined);
    } catch (error) {
      return Err(new ServiceUnavailableError('Listing SEO rollback save failed', error));
    }
  }

  private async restoreOrRecordListingSeoRollbackFailure(
    event: HermesEvent,
    product: Product,
    change: Extract<ProposedChange, { kind: 'title' | 'description' }>,
    value: string,
    reason: string
  ): Promise<Result<void>> {
    const restored = await this.restoreListingSeoProductValue(product, change, value);
    if (restored.isErr()) {
      await this.recordListingSeoRollbackFailure(event, reason, restored.error);
    }
    return restored;
  }

  private async recordListingSeoReconciliationFailure(
    event: HermesEvent,
    reason: string
  ): Promise<void> {
    await this.activityLog.record({
      id: this.idGenerator(),
      workspaceId: event.workspaceId,
      entityType: 'hermes_event',
      entityId: event.id,
      actorType: 'hermes',
      action: 'hermes_event.reconciliation_failed',
      metadata: {
        eventType: event.type,
        proposedChange: event.proposedChange as unknown as Record<string, unknown> | null,
        reason,
      },
      createdAt: new Date(),
    });
  }

  private async recordListingSeoRollbackFailure(
    event: HermesEvent,
    reason: string,
    error: Error
  ): Promise<void> {
    await this.activityLog.record({
      id: this.idGenerator(),
      workspaceId: event.workspaceId,
      entityType: 'hermes_event',
      entityId: event.id,
      actorType: 'hermes',
      action: 'hermes_event.reconciliation_rollback_failed',
      metadata: {
        eventType: event.type,
        proposedChange: event.proposedChange as unknown as Record<string, unknown> | null,
        reason,
        rollbackError: this.errorMessage(error),
      },
      createdAt: new Date(),
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private listingSeoSourceFor(product: Product, listing: Listing | null): string {
    return seoSourceFingerprint({
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        condition: product.condition,
        tags: [...product.tags],
        imageCount: product.imageCount,
      },
      listing: listing
        ? {
            id: listing.id,
            title: product.name,
            description: product.description,
            marketplace: listing.marketplaceId,
          }
        : null,
    });
  }

  private async applyPriceChange(
    event: HermesEvent,
    change: Extract<ProposedChange, { kind: 'price' }>
  ): Promise<Result<ApplyChangeOutcome>> {
    const loaded = await this.requireProduct(event.productId);
    if (loaded.isErr()) return loaded;
    const product = loaded.value;

    const money = Money.of(change.to, product.sellingPrice.currency);
    if (money.isErr()) return money;

    // Approved AI price changes may go below cost; > 20% drops were already gated
    // to human review by HermesEvent.requiresHumanReview() before reaching approval.
    const updated = product.updateSellingPrice(money.value, true);
    if (updated.isErr()) return updated;
    await this.productRepo.save(product);

    const listings = await this.listingRepo.findByProduct(product.id);
    const now = new Date();
    for (const listing of listings) {
      const listingPrice = Money.of(change.to, listing.price.currency);
      if (listingPrice.isErr()) return listingPrice;
      const listingUpdated = listing.updatePrice(listingPrice.value);
      if (listingUpdated.isErr()) return listingUpdated;
      await this.listingRepo.save(listing);
      await this.priceHistory.record({
        id: this.idGenerator(),
        listingId: listing.id,
        oldPrice: change.from,
        newPrice: change.to,
        changedBy: 'hermes',
        reason: event.detail ?? event.title,
        createdAt: now,
      });
    }

    return this.enqueueMarketplaceUpdates(product, { price: change.to });
  }

  private async applyProductTextChange(
    event: HermesEvent,
    change: Extract<ProposedChange, { kind: 'title' | 'description' }>
  ): Promise<Result<ApplyChangeOutcome>> {
    const loaded = await this.requireProduct(event.productId);
    if (loaded.isErr()) return loaded;
    const product = loaded.value;
    const rollbackValue = change.kind === 'title' ? product.name : product.description;
    const changed =
      change.kind === 'title' ? product.rename(change.to) : product.updateDescription(change.to);
    if (changed.isErr()) return changed;

    await this.productRepo.save(product);
    let queued: Result<ApplyChangeOutcome>;
    try {
      queued = await this.enqueueMarketplaceUpdates(
        product,
        change.kind === 'title' ? { productName: change.to } : { description: change.to },
        { requireAllLiveTargets: true }
      );
    } catch (error) {
      const restored = await this.restoreOrRecordListingSeoRollbackFailure(
        event,
        product,
        change,
        rollbackValue,
        'queue_acceptance_failed'
      );
      if (restored.isErr()) throw restored.error;
      throw error;
    }

    if (queued.isErr()) {
      const restored = await this.restoreOrRecordListingSeoRollbackFailure(
        event,
        product,
        change,
        rollbackValue,
        'apply_failed'
      );
      if (restored.isErr()) return restored;
      return queued;
    }
    if ((queued.value.skippedLiveListings?.length ?? 0) > 0) {
      const restored = await this.restoreOrRecordListingSeoRollbackFailure(
        event,
        product,
        change,
        rollbackValue,
        'missing_live_listing_update'
      );
      if (restored.isErr()) return restored;
      return Err(
        new InvalidStateError(
          'Product text changes require connected marketplace updates for every live listing'
        )
      );
    }
    return queued;
  }

  private async applyRelist(
    listingIds: string[],
    actorId?: string
  ): Promise<Result<ApplyChangeOutcome>> {
    const candidates: Array<{
      operation: MarketplaceUpdateOperation;
      job: PublishListingJob;
      listing: Listing;
      product: Product;
      marketplace: Marketplace;
    }> = [];
    for (const listingId of listingIds) {
      const listing = await this.listingRepo.findById(listingId);
      if (!listing) continue;
      const product = await this.productRepo.findById(listing.productId);
      const marketplace = await this.marketplaceRepo.findById(listing.marketplaceId);
      if (!product || !marketplace) continue;
      if (!marketplace.isConnected()) continue;
      if (this.marketplaceAccountRepo) {
        const account = await this.marketplaceAccountRepo.findByMarketplaceId(marketplace.id);
        if (!account || account.status !== 'connected') continue;
      }

      const operationId = this.idGenerator();
      candidates.push({
        operation: { operationId, listingId: listing.id, marketplaceId: marketplace.id },
        listing,
        product,
        marketplace,
        job: {
          operationId,
          mode: 'relist',
          listingUpdatedAt: listing.updatedAt.toISOString(),
          marketplaceKey: marketplace.key,
          marketplaceId: marketplace.id,
          listingId: listing.id,
          input: {
            productName: product.name,
            description: product.description,
            price: listing.price.amount,
            currency: listing.price.currency,
            category: product.category,
            marketplaceCategory: listing.marketplaceCategory,
            condition: product.condition,
            imageUrls: [...product.images],
          },
        },
      });
    }
    if (candidates.length === 0 && listingIds.length > 0) {
      return Err(new InvalidStateError('relist event references no valid listings to publish'));
    }

    const hasOlxCandidate = candidates.some(({ marketplace }) => marketplace.key === 'olx');
    const olxQuota = this.olxQuota;
    if (hasOlxCandidate && !olxQuota) {
      return Err(
        new GuardrailViolationError(
          'OLX publication quota guard is unavailable; relist fails closed',
          {
            quotaDecision: {
              applicable: true,
              marketplaceKey: 'olx',
              status: 'unknown',
              decision: 'block',
              reason: 'quota_guard_unavailable',
              requiresOverride: true,
            },
          }
        )
      );
    }

    const authorizedCandidates: typeof candidates = [];
    const blockedCandidates: Array<{
      listingId: string;
      decision: Awaited<ReturnType<OlxPublicationQuotaService['authorize']>>;
    }> = [];
    for (const candidate of candidates) {
      const { operation, listing, product, marketplace } = candidate;
      if (marketplace.key === 'olx' && olxQuota) {
        const quotaDecision = await olxQuota.authorize({
          operationId: operation.operationId,
          mode: 'relist',
          listing,
          product,
          marketplace,
          actorId,
        });
        if (quotaDecision.decision === 'block') {
          blockedCandidates.push({ listingId: listing.id, decision: quotaDecision });
          continue;
        }
      }
      authorizedCandidates.push(candidate);
    }

    if (authorizedCandidates.length === 0 && blockedCandidates.length > 0) {
      return Err(olxQuota!.guardError(blockedCandidates[0].decision));
    }

    for (const { operation, job } of authorizedCandidates) {
      await this.publishQueue.enqueue(job, { jobId: `publish:${operation.operationId}` });
    }
    return Ok({
      marketplaceUpdates: authorizedCandidates.map(({ operation }) => operation),
      skippedLiveListings: blockedCandidates.map(({ listingId, decision }) => ({
        listingId,
        reason: decision.reason,
      })),
    });
  }

  private async enqueueMarketplaceUpdates(
    product: Product,
    changes: MarketplaceUpdateChanges,
    options: EnqueueMarketplaceUpdateOptions = {}
  ): Promise<Result<ApplyChangeOutcome>> {
    const queueItems: Array<{
      operation: MarketplaceUpdateOperation;
      data: PublishListingJob;
      options: { jobId: string };
    }> = [];
    const skippedLiveListings: Array<{ listingId: string; reason: string }> = [];
    const listings = await this.listingRepo.findByProduct(product.id);
    for (const listing of listings) {
      if (!this.isListingSeoLiveTarget(listing)) continue;

      const marketplace = await this.marketplaceRepo.findById(listing.marketplaceId);
      if (!marketplace || !marketplace.isConnected()) {
        skippedLiveListings.push({ listingId: listing.id, reason: 'marketplace_not_connected' });
        continue;
      }
      if (this.marketplaceAccountRepo) {
        const account = await this.marketplaceAccountRepo.findByMarketplaceId(marketplace.id);
        if (!account || account.status !== 'connected') {
          skippedLiveListings.push({
            listingId: listing.id,
            reason: 'marketplace_account_not_connected',
          });
          continue;
        }
      }

      const operationId = this.idGenerator();
      queueItems.push({
        operation: { operationId, listingId: listing.id, marketplaceId: marketplace.id },
        options: { jobId: `update:${operationId}` },
        data: {
          operationId,
          mode: 'update',
          listingUpdatedAt: listing.updatedAt.toISOString(),
          productUpdatedAt: product.updatedAt.toISOString(),
          marketplaceKey: marketplace.key,
          marketplaceId: marketplace.id,
          listingId: listing.id,
          input: {
            productName: product.name,
            description: product.description,
            price: listing.price.amount,
            currency: listing.price.currency,
            category: product.category,
            marketplaceCategory: listing.marketplaceCategory,
            condition: product.condition,
            imageUrls: [...product.images],
          },
          changes,
        },
      });
    }
    if (options.requireAllLiveTargets && skippedLiveListings.length > 0) {
      return Ok({ marketplaceUpdates: [], skippedLiveListings });
    }
    await this.publishQueue.enqueueAll(
      queueItems.map((item) => ({ data: item.data, options: item.options }))
    );
    return Ok({
      marketplaceUpdates: queueItems.map((item) => item.operation),
      skippedLiveListings,
    });
  }

  private async requireProduct(productId: string | null): Promise<Result<Product>> {
    if (!productId) {
      return Err(new InvalidStateError('Event has no product to apply the change to'));
    }
    const product = await this.productRepo.findById(productId);
    if (!product) {
      return Err(new NotFoundError(`Product not found: ${productId}`));
    }
    return Ok(product);
  }

  private appliedEvent(event: HermesEvent): DomainEvent {
    return {
      type: 'hermes.event.applied',
      aggregateType: 'HermesEvent',
      aggregateId: event.id,
      payload: {
        eventId: event.id,
        workspaceId: event.workspaceId,
        productId: event.productId ?? undefined,
        eventType: event.type,
      },
      occurredAt: new Date(),
    };
  }
}
