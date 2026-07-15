// Domain service orchestrating Listing publish / relist / expire flows.
// Marketplace API calls happen in infrastructure adapters; this service enforces
// the domain rules and emits events. The external listing id (from the adapter)
// is passed in by the application layer.

import { Result, Ok, Err } from '../shared/Result';
import { NotFoundError } from '../shared/DomainError';
import { Listing } from '../entities/Listing';
import type { IListingRepository } from '../repositories/interfaces/IListingRepository';
import type { IProductRepository } from '../repositories/interfaces/IProductRepository';
import type { IMarketplaceRepository } from '../repositories/interfaces/IMarketplaceRepository';
import type { IEventPublisher, DomainEvent } from '../ports/IEventPublisher';

export type ListingPersistenceTransaction = <T>(
  work: (repos: { listingRepo: IListingRepository; productRepo: IProductRepository }) => Promise<T>,
) => Promise<T>;

export class ListingService {
  constructor(
    private readonly listingRepo: IListingRepository,
    private readonly productRepo: IProductRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly eventPublisher: IEventPublisher,
    private readonly transaction?: ListingPersistenceTransaction,
  ) {}

  async publishListing(
    listingId: string,
    externalListingId: string,
    externalUrl: string | null = null,
    publishedAt: Date = new Date(),
    expiresAt: Date | null = null,
    remoteStatus: string | null = null,
    remoteImageUrls: string[] = [],
  ): Promise<Result<Listing>> {
    const listing = await this.listingRepo.findById(listingId);
    if (!listing) return Err(new NotFoundError(`Listing not found: ${listingId}`));

    const product = await this.productRepo.findById(listing.productId);
    if (!product) {
      return Err(new NotFoundError(`Product not found: ${listing.productId}`));
    }

    const marketplace = await this.marketplaceRepo.findById(listing.marketplaceId);
    if (!marketplace) {
      return Err(new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`));
    }

    const published = listing.publish(
      product,
      marketplace,
      externalListingId,
      externalUrl,
      publishedAt,
      expiresAt,
      remoteStatus,
    );
    if (published.isErr()) return published;

    const persist = async (repos: { listingRepo: IListingRepository; productRepo: IProductRepository }) => {
      if (remoteImageUrls.length > 0) {
        product.clearImages();
        for (const imageUrl of remoteImageUrls) {
          const added = product.addImage(imageUrl);
          if (added.isErr()) return added;
        }
        await repos.productRepo.save(product);
      }
      await repos.listingRepo.save(listing);
      return Ok(undefined);
    };

    const persisted = this.transaction
      ? await this.transaction(persist)
      : await persist({ listingRepo: this.listingRepo, productRepo: this.productRepo });
    if (persisted.isErr()) return persisted;
    await this.publish('listing.published', listing.id, {
      listingId: listing.id,
      productId: listing.productId,
      marketplaceId: listing.marketplaceId,
      externalListingId,
      externalUrl,
      remoteStatus: listing.remoteStatus,
      remoteImageCount: remoteImageUrls.length,
    });

    return Ok(listing);
  }

  // Idempotency probe for the publish job handler: reports whether a listing was
  // already published (live + marketplaceListingId set) so a retry after a
  // partial failure can finalize/short-circuit without re-issuing the
  // non-idempotent marketplace publish (CR2/CR3).
  async getPublishState(
    listingId: string,
  ): Promise<{
    isPublished: boolean;
    externalListingId: string | null;
    externalUrl: string | null;
    publishedAt: Date | null;
    updatedAt?: Date | null;
  } | null> {
    const listing = await this.listingRepo.findById(listingId);
    if (!listing) return null;
    return {
      isPublished: listing.isLive() && listing.marketplaceListingId !== null,
      externalListingId: listing.marketplaceListingId,
      externalUrl: listing.externalUrl,
      publishedAt: listing.publishedAt,
      updatedAt: listing.updatedAt,
    };
  }

  async relistListing(
    listingId: string,
    publishedAt: Date = new Date(),
    expiresAt: Date | null = null,
  ): Promise<Result<Listing>> {
    const listing = await this.listingRepo.findById(listingId);
    if (!listing) return Err(new NotFoundError(`Listing not found: ${listingId}`));

    const relisted = listing.relist(publishedAt, expiresAt);
    if (relisted.isErr()) return relisted;

    await this.listingRepo.save(listing);
    await this.publish('listing.relisted', listing.id, {
      listingId: listing.id,
      productId: listing.productId,
      marketplaceId: listing.marketplaceId,
    });

    return Ok(listing);
  }

  async expireListing(listingId: string): Promise<Result<Listing>> {
    const listing = await this.listingRepo.findById(listingId);
    if (!listing) return Err(new NotFoundError(`Listing not found: ${listingId}`));

    const expired = listing.expire();
    if (expired.isErr()) return expired;

    await this.listingRepo.save(listing);
    await this.publish('listing.expired', listing.id, {
      listingId: listing.id,
      productId: listing.productId,
      marketplaceId: listing.marketplaceId,
    });

    return Ok(listing);
  }

  // Sweep: expire all live listings whose expiry has passed.
  async expireLapsed(before: Date = new Date()): Promise<Result<Listing[]>> {
    const candidates = await this.listingRepo.findExpiring(before);
    const expired: Listing[] = [];
    for (const listing of candidates) {
      const result = listing.expire();
      if (result.isOk()) expired.push(listing);
    }
    if (expired.length > 0) {
      await this.listingRepo.saveAll(expired);
    }
    return Ok(expired);
  }

  private async publish(
    type: string,
    listingId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: DomainEvent = {
      type,
      aggregateType: 'Listing',
      aggregateId: listingId,
      payload,
      occurredAt: new Date(),
    };
    await this.eventPublisher.publish(event);
  }
}
