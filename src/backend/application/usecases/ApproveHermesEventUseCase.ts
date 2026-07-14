// Use case: approve a pending Hermes event and apply its proposed change
// (ARCHITECTURE.md §10 apply semantics).
//   - The event MUST be in pending_review (rejected otherwise).
//   - price/title/description changes mutate the product aggregate.
//   - price changes additionally append a PriceHistory record per affected listing.
//   - relist changes enqueue publish jobs for the referenced listings.
//   - every approval records an ActivityLog entry, marks the event applied, and
//     emits a domain event.

import { Result, Ok, Err } from '../../domain/shared/Result';
import { NotFoundError, InvalidStateError } from '../../domain/shared/DomainError';
import { Money } from '../../domain/valueObjects/Money';
import type { HermesEvent } from '../../domain/entities/HermesEvent';
import type { Product } from '../../domain/entities/Product';
import type { ProposedChange } from '../../../shared/types';
import type { IEventRepository } from '../../domain/repositories/interfaces/IEventRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IEventPublisher, DomainEvent } from '../../domain/ports/IEventPublisher';
import type { IPriceHistoryRecorder } from '../ports/IPriceHistoryRecorder';
import type { IJobQueue, PublishListingJob } from '../ports/IJobQueue';
import type { IdGenerator } from '../ports/IdGenerator';
import type { ApproveEventDTO } from '../dto/ApproveEventDTO';
import type { MarketplaceAccountRepository } from '../services/MarketplaceOAuthService';

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
    private readonly marketplaceAccountRepo?: MarketplaceAccountRepository
  ) {}

  async execute(input: ApproveEventDTO): Promise<Result<HermesEvent>> {
    // Tenant-scoped load: reject events belonging to another workspace (S2).
    const event = await this.eventRepo.findByIdForWorkspace(input.eventId, input.workspaceId);
    if (!event) {
      return Err(new NotFoundError(`Hermes event not found: ${input.eventId}`));
    }

    if (event.status !== 'pending_review') {
      return Err(
        new InvalidStateError(
          `Cannot approve event in ${event.status} state (must be pending_review)`
        )
      );
    }

    const applied = await this.applyChange(event);
    if (applied.isErr()) return applied;

    const approved = event.approve();
    if (approved.isErr()) return approved;

    await this.eventRepo.save(event);

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
      },
      createdAt: event.resolvedAt ?? new Date(),
    });

    await this.eventPublisher.publish(this.appliedEvent(event));

    return Ok(event);
  }

  private async applyChange(event: HermesEvent): Promise<Result<void>> {
    const change = event.proposedChange;
    if (change === null) return Ok(undefined);

    switch (change.kind) {
      case 'price':
        return this.applyPriceChange(event, change);
      case 'title': {
        const product = await this.requireProduct(event.productId);
        if (product.isErr()) return product;
        const renamed = product.value.rename(change.to);
        if (renamed.isErr()) return renamed;
        await this.productRepo.save(product.value);
        return Ok(undefined);
      }
      case 'description': {
        const product = await this.requireProduct(event.productId);
        if (product.isErr()) return product;
        const updated = product.value.updateDescription(change.to);
        if (updated.isErr()) return updated;
        await this.productRepo.save(product.value);
        return Ok(undefined);
      }
      case 'relist':
        // Enqueues an actual republish job per referenced listing (real action).
        return this.applyRelist(change.listingIds);
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
      default:
        return Ok(undefined);
    }
  }

  private async applyPriceChange(
    event: HermesEvent,
    change: Extract<ProposedChange, { kind: 'price' }>
  ): Promise<Result<void>> {
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

    return Ok(undefined);
  }

  private async applyRelist(listingIds: string[]): Promise<Result<void>> {
    let enqueued = 0;
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
      await this.publishQueue.enqueue(
        {
          operationId,
          marketplaceKey: marketplace.key,
          marketplaceId: marketplace.id,
          listingId: listing.id,
          input: {
            productName: product.name,
            description: product.description,
            price: listing.price.amount,
            currency: listing.price.currency,
            category: product.category,
            condition: product.condition,
            imageUrls: [...product.images],
          },
        },
        { jobId: `publish:${operationId}` }
      );
      enqueued++;
    }
    if (enqueued === 0 && listingIds.length > 0) {
      return Err(new InvalidStateError('relist event references no valid listings to publish'));
    }
    return Ok(undefined);
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
