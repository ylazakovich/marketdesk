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
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IJobQueue, PublishListingJob } from '../ports/IJobQueue';
import type { IdGenerator } from '../ports/IdGenerator';
import type { PublishListingDTO } from '../dto/PublishListingDTO';

export class PublishListingUseCase {
  constructor(
    private readonly listingRepo: IListingRepository,
    private readonly productRepo: IProductRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly publishQueue: IJobQueue<PublishListingJob>,
    private readonly activityLog: IActivityLogRepository,
    private readonly idGenerator: IdGenerator,
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

    if (!marketplace.isConnected()) {
      return Err(
        new GuardrailViolationError(
          `Marketplace ${marketplace.key} must be connected before publishing`,
        ),
      );
    }
    if (!product.canPublish()) {
      return Err(new InvalidStateError('Cannot publish a listing for a sold product'));
    }
    if (listing.price.isZero()) {
      return Err(new InvalidStateError('Listing price must be set before publish'));
    }

    await this.publishQueue.enqueue({
      marketplaceKey: marketplace.key,
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
    });

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
