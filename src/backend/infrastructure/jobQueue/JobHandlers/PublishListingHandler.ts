// Job handler: publish a listing to a marketplace via the appropriate adapter,
// then finalize the listing in the DB (status -> live, marketplaceListingId set,
// publishedAt recorded) via the injected listing finalizer. Depends only on injected
// interfaces (adapter resolver, IEventPublisher, ListingFinalizer) — no concrete
// application services.

import type {
  PublishResult,
} from '../../../domain/services/MarketplaceAdapter';
import type { MarketplaceKey } from '../../../../shared/types';
import type { IMarketplaceAdapter } from '../../../domain/services/MarketplaceAdapter';
import type { MarketplaceHttpClient } from '../../adapters/MarketplaceHttpClient';
import type { IEventPublisher } from '../../../domain/ports/IEventPublisher';
import type { Result } from '../../../domain/shared/Result';
import type { Listing } from '../../../domain/entities/Listing';
import { InvalidStateError } from '../../../domain/shared/DomainError';
import type { PublishListingJob } from '../../../application/ports/IJobQueue';

export type PublishListingJobData = PublishListingJob;

async function retrySafePhase<T>(
  operation: () => Promise<T>,
  succeeded: (value: T) => boolean = () => true,
  attempts = 3,
): Promise<T> {
  let lastValue: T | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastValue = await operation();
      if (succeeded(lastValue) || attempt === attempts) return lastValue;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
  }
  return lastValue as T;
}

export interface PublishMarketplaceAdapterResolver {
  create(key: MarketplaceKey, http?: MarketplaceHttpClient): IMarketplaceAdapter;
}

export interface MarketplaceAccessTokenProvider {
  getValidAccessToken(marketplaceId: string): Promise<string>;
}

export interface PublishListingResult {
  marketplaceKey: MarketplaceKey;
  listingId: string;
  result: PublishResult;
  // Whether the listing aggregate was finalized (persisted live) in the DB.
  finalized: boolean;
}

// Structural port for finalizing a listing after a successful marketplace publish.
// Satisfied by the domain ListingService (which persists the listing and emits the
// canonical `listing.published` event) without importing the concrete class here.
export interface ListingFinalizer {
  publishListing(
    listingId: string,
    externalListingId: string,
    publishedAt?: Date,
    expiresAt?: Date | null,
  ): Promise<Result<Listing>>;
  // Optional idempotency probe: reports whether the listing was already published
  // (live + marketplaceListingId set) by a prior attempt. Lets the handler skip the
  // non-idempotent adapter publish on retry so it never creates a duplicate remote
  // listing (see CR2/CR3). When absent, the handler always publishes.
  getPublishState?(
    listingId: string,
  ): Promise<{ isPublished: boolean; externalListingId: string | null; publishedAt: Date | null } | null>;
}

// Thrown when the adapter publish succeeded (a real, non-idempotent side effect
// created the remote listing) but all safe in-process DB finalization attempts failed.
// Bull must not retry the whole job because that could publish a duplicate; the
// externalListingId is retained for manual reconciliation/alerting.
export class ListingFinalizationError extends Error {
  constructor(
    readonly listingId: string,
    readonly marketplaceKey: MarketplaceKey,
    readonly externalListingId: string,
    readonly cause: unknown,
  ) {
    super(
      `Marketplace publish succeeded for listing ${listingId} on ${marketplaceKey} ` +
        `(externalListingId=${externalListingId}) but DB finalization failed; ` +
        `manual reconciliation is required without re-publishing`,
    );
    this.name = 'ListingFinalizationError';
  }
}

export class PublishListingHandler {
  constructor(
    private readonly adapters: PublishMarketplaceAdapterResolver,
    private readonly events?: IEventPublisher,
    private readonly listings?: ListingFinalizer,
    private readonly accessTokens?: MarketplaceAccessTokenProvider,
    private readonly authenticatedHttpClient?: (accessToken: string) => MarketplaceHttpClient,
  ) {}

  async handle(data: PublishListingJobData): Promise<PublishListingResult> {
    // Idempotency guard (CR3): if a prior attempt already published this listing
    // to the marketplace, do NOT re-POST (which would create a duplicate — CR2).
    // The remote resource exists; just report the already-finalized state.
    if (this.listings?.getPublishState) {
      const state = await this.listings.getPublishState(data.listingId);
      if (state?.isPublished && state.externalListingId) {
        return {
          marketplaceKey: data.marketplaceKey,
          listingId: data.listingId,
          result: {
            externalListingId: state.externalListingId,
            publishedAt: state.publishedAt ?? new Date(),
          },
          finalized: true,
        };
      }
    }

    let adapter: IMarketplaceAdapter;
    if (data.marketplaceKey === 'olx' && this.accessTokens && this.authenticatedHttpClient) {
      if (!data.marketplaceId) {
        throw new InvalidStateError('Publish job is missing marketplaceId for OLX OAuth');
      }
      const accessToken = await retrySafePhase(() =>
        this.accessTokens!.getValidAccessToken(data.marketplaceId),
      );
      adapter = this.adapters.create(
        data.marketplaceKey,
        this.authenticatedHttpClient(accessToken),
      );
    } else {
      adapter = this.adapters.create(data.marketplaceKey);
    }
    const result = await adapter.publish(data.input);

    // Finalize the listing in the DB when a finalizer is wired: status -> live,
    // marketplaceListingId set, publishedAt recorded. ListingService.publishListing
    // persists the aggregate and emits the canonical `listing.published` event.
    if (this.listings) {
      const finalizeResult = await retrySafePhase(
        () => this.listings!.publishListing(
          data.listingId,
          result.externalListingId,
          result.publishedAt,
        ),
        (attempt) => attempt.isOk(),
      );
      if (finalizeResult.isErr()) {
        // CR3: the remote listing now EXISTS but the DB was not updated. Do not
        // swallow this and report success. Safe finalization retries are exhausted;
        // Bull itself must not rerun the non-idempotent publish job.
        throw new ListingFinalizationError(
          data.listingId,
          data.marketplaceKey,
          result.externalListingId,
          finalizeResult.error,
        );
      }
      return {
        marketplaceKey: data.marketplaceKey,
        listingId: data.listingId,
        result,
        finalized: true,
      };
    }

    // No finalizer wired: emit a fallback event so consumers still see exactly
    // one publish signal (the finalizer, when present, emits its own richer one).
    if (this.events) {
      await this.events.publish({
        type: 'listing.published',
        aggregateType: 'listing',
        aggregateId: data.listingId,
        payload: {
          marketplaceKey: data.marketplaceKey,
          externalListingId: result.externalListingId,
        },
        occurredAt: new Date(),
      });
    }

    return {
      marketplaceKey: data.marketplaceKey,
      listingId: data.listingId,
      result,
      finalized: false,
    };
  }
}
