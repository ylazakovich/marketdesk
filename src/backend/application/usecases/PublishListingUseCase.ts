// Use case: publish a listing to its marketplace. Publishing is asynchronous — the
// use case loads the listing/product/marketplace, verifies the publish preconditions
// (marketplace connected, product publishable, price set), records the intent in the
// activity log and enqueues a publish job. The job (Group 6) performs the marketplace
// call and finalizes the listing via ListingService with the returned external id.

import { Result, Ok, Err } from '../../domain/shared/Result';
import {
  NotFoundError,
  InvalidStateError,
  GuardrailViolationError,
} from '../../domain/shared/DomainError';
import type { Listing } from '../../domain/entities/Listing';
import type { Product } from '../../domain/entities/Product';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IJobQueue, PublishListingJob } from '../ports/IJobQueue';
import type { IdGenerator } from '../ports/IdGenerator';
import type { PublishListingDTO } from '../dto/PublishListingDTO';
import type { MarketplaceAccountRepository } from '../services/MarketplaceOAuthService';
import type { OlxPublicationQuotaService } from '../services/OlxPublicationQuotaService';
import { evaluateOlxCategory } from '../../domain/services/OlxCategoryGuard';

export interface PublishEligibility {
  canPublish: boolean;
  warnings: string[];
  error?: GuardrailViolationError | InvalidStateError;
}

export function evaluatePublishEligibility(
  listing: Listing,
  product: Product,
  marketplace: Marketplace
): PublishEligibility {
  const warnings: string[] = [];
  let error: GuardrailViolationError | InvalidStateError | undefined;

  if (!marketplace.isConnected()) {
    warnings.push(`Marketplace ${marketplace.key} is not connected`);
    error ??= new GuardrailViolationError(
      `Marketplace ${marketplace.key} must be connected before publishing`
    );
  }
  if (!product.canPublish()) {
    warnings.push('Cannot publish a sold product');
    error ??= new InvalidStateError('Cannot publish a listing for a sold product');
  }
  if (listing.price.isZero()) {
    warnings.push('Listing price must be set before publish');
    error ??= new InvalidStateError('Listing price must be set before publish');
  }

  return { canPublish: warnings.length === 0, warnings, error };
}

export class PublishListingUseCase {
  constructor(
    private readonly listingRepo: IListingRepository,
    private readonly productRepo: IProductRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly publishQueue: IJobQueue<PublishListingJob>,
    private readonly activityLog: IActivityLogRepository,
    private readonly idGenerator: IdGenerator,
    private readonly marketplaceAccountRepo?: MarketplaceAccountRepository,
    private readonly olxQuota?: OlxPublicationQuotaService,
  ) {}

  async execute(input: PublishListingDTO): Promise<Result<Listing>> {
    const listing = await this.listingRepo.findById(input.listingId);
    if (!listing) {
      return Err(new NotFoundError(`Listing not found: ${input.listingId}`));
    }

    const product = await this.productRepo.findById(listing.productId);
    if (!product) {
      return Err(new NotFoundError(`Product not found: ${listing.productId}`));
    }

    const marketplace = await this.marketplaceRepo.findById(listing.marketplaceId);
    if (!marketplace) {
      return Err(new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`));
    }

    const eligibility = evaluatePublishEligibility(listing, product, marketplace);
    if (!eligibility.canPublish) {
      return Err(eligibility.error ?? new InvalidStateError(eligibility.warnings[0]));
    }

    if (this.marketplaceAccountRepo) {
      const account = await this.marketplaceAccountRepo.findByMarketplaceId(marketplace.id);
      if (!account || account.status !== 'connected') {
        return Err(
          new GuardrailViolationError(
            `Marketplace ${marketplace.key} OAuth account must be connected before publishing`
          )
        );
      }
    }

    const operationId = this.idGenerator();
    if (marketplace.key === 'olx') {
      const categoryDecision = evaluateOlxCategory(product, listing.marketplaceCategory);
      if (!categoryDecision.allowed) {
        return Err(new GuardrailViolationError(
          categoryDecision.message ?? 'OLX category validation blocks publication',
          { categoryDecision, marketplaceCategory: listing.marketplaceCategory },
        ));
      }
      if (!this.olxQuota) {
        return Err(
          new GuardrailViolationError(
            'OLX publication quota guard is unavailable; publication fails closed',
            {
              quotaDecision: {
                applicable: true,
                marketplaceKey: 'olx',
                status: 'unknown',
                decision: 'block',
                reason: 'quota_guard_unavailable',
                requiresOverride: true,
              },
            },
          ),
        );
      }
      const quotaDecision = await this.olxQuota.authorize({
        operationId,
        mode: input.mode ?? 'publish',
        listing,
        product,
        marketplace,
        actorId: input.actorId,
        override: input.quotaOverride,
      });
      if (quotaDecision.decision === 'block') {
        return Err(this.olxQuota.guardError(quotaDecision));
      }
    }
    await this.publishQueue.enqueue(
      {
        operationId,
        mode: input.mode ?? 'publish',
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
      { jobId: `publish:${operationId}` }
    );

    await this.activityLog.record({
      id: this.idGenerator(),
      workspaceId: product.workspaceId,
      entityType: 'listing',
      entityId: listing.id,
      actorType: 'user',
      actorId: input.actorId,
      action: 'listing.publish_requested',
      metadata: { marketplaceKey: marketplace.key, productId: product.id },
      createdAt: new Date(),
    });

    return Ok(listing);
  }
}
