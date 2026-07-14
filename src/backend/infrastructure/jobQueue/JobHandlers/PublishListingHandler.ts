// Job handler: publish a listing to a marketplace via the appropriate adapter,
// then finalize the listing in the DB (status -> live, marketplaceListingId set,
// publishedAt recorded) via the injected listing finalizer. Depends only on injected
// interfaces (adapter resolver, IEventPublisher, ListingFinalizer) — no concrete
// application services.

import type { PublishResult } from '../../../domain/services/MarketplaceAdapter';
import type { MarketplaceKey } from '../../../../shared/types';
import type { IMarketplaceAdapter } from '../../../domain/services/MarketplaceAdapter';
import type { MarketplaceHttpClient } from '../../adapters/MarketplaceHttpClient';
import type { IEventPublisher } from '../../../domain/ports/IEventPublisher';
import type { Result } from '../../../domain/shared/Result';
import type { Listing } from '../../../domain/entities/Listing';
import { InvalidStateError, ServiceUnavailableError } from '../../../domain/shared/DomainError';
import type { PublishListingJob } from '../../../application/ports/IJobQueue';

export type PublishListingJobData = PublishListingJob;

async function retryTransientPhase<T>(
  operation: () => Promise<T>,
  succeeded: (value: T) => boolean = () => true,
  failure: (value: T) => unknown = () => undefined,
  attempts = 3,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
  let lastValue: T | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastValue = await operation();
      if (succeeded(lastValue) || attempt === attempts) return lastValue;
      if (!(failure(lastValue) instanceof ServiceUnavailableError)) return lastValue;
    } catch (error) {
      if (!(error instanceof ServiceUnavailableError) || attempt === attempts) throw error;
    }
    await sleep(50 * 2 ** (attempt - 1));
  }
  return lastValue as T;
}

export interface PublishAttemptCheckpoint {
  operationId: string;
  listingId: string;
  marketplaceKey: MarketplaceKey;
  status: 'publishing' | 'published';
  externalListingId: string | null;
  publishedAt: Date | null;
}

export interface PublishAttemptStore {
  find(operationId: string): Promise<PublishAttemptCheckpoint | null>;
  begin(
    operationId: string,
    listingId: string,
    marketplaceKey: MarketplaceKey
  ): Promise<{ created: boolean; checkpoint: PublishAttemptCheckpoint }>;
  markPublished(operationId: string, result: PublishResult): Promise<void>;
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
    expiresAt?: Date | null
  ): Promise<Result<Listing>>;
  // Optional idempotency probe: reports whether the listing was already published
  // (live + marketplaceListingId set) by a prior attempt. Lets the handler skip the
  // non-idempotent adapter publish on retry so it never creates a duplicate remote
  // listing (see CR2/CR3). When absent, the handler always publishes.
  getPublishState?(listingId: string): Promise<{
    isPublished: boolean;
    externalListingId: string | null;
    publishedAt: Date | null;
  } | null>;
}

// Thrown when the adapter publish succeeded (a real, non-idempotent side effect
// created the remote listing) but all safe in-process DB finalization attempts failed.
// The durable published checkpoint lets Bull retry finalization without repeating
// the provider POST; the externalListingId is retained for reconciliation/alerting.
export class ListingFinalizationError extends Error {
  constructor(
    readonly listingId: string,
    readonly marketplaceKey: MarketplaceKey,
    readonly externalListingId: string,
    readonly cause: unknown
  ) {
    super(
      `Marketplace publish succeeded for listing ${listingId} on ${marketplaceKey} ` +
        `(externalListingId=${externalListingId}) but DB finalization failed; ` +
        `retry will resume finalization without re-publishing`
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
    private readonly publishAttempts?: PublishAttemptStore
  ) {}

  async handle(data: PublishListingJobData): Promise<PublishListingResult> {
    // Backward-compatible fallback for jobs that were already queued before
    // operationId became part of the payload. New enqueue paths always set it.
    const operationId = data.operationId ?? data.listingId;
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

    let result: PublishResult | undefined;
    const checkpoint = await this.publishAttempts?.find(operationId);
    if (checkpoint?.status === 'published' && checkpoint.externalListingId) {
      result = {
        externalListingId: checkpoint.externalListingId,
        publishedAt: checkpoint.publishedAt ?? new Date(),
      };
    } else if (checkpoint?.status === 'publishing') {
      throw new InvalidStateError(
        `Listing ${data.listingId} has an ambiguous in-flight marketplace publish; reconcile it before retrying`
      );
    }

    if (!result) {
      let adapter: IMarketplaceAdapter;
      if (data.marketplaceKey === 'olx' && this.accessTokens && this.authenticatedHttpClient) {
        if (!data.marketplaceId) {
          throw new InvalidStateError('Publish job is missing marketplaceId for OLX OAuth');
        }
        const accessToken = await retryTransientPhase(() =>
          this.accessTokens!.getValidAccessToken(data.marketplaceId)
        );
        adapter = this.adapters.create(
          data.marketplaceKey,
          this.authenticatedHttpClient(accessToken)
        );
      } else {
        adapter = this.adapters.create(data.marketplaceKey);
      }

      if (this.publishAttempts) {
        const started = await this.publishAttempts.begin(
          operationId,
          data.listingId,
          data.marketplaceKey
        );
        if (!started.created) {
          if (started.checkpoint.status === 'published' && started.checkpoint.externalListingId) {
            result = {
              externalListingId: started.checkpoint.externalListingId,
              publishedAt: started.checkpoint.publishedAt ?? new Date(),
            };
          } else {
            throw new InvalidStateError(
              `Listing ${data.listingId} has an ambiguous in-flight marketplace publish; reconcile it before retrying`
            );
          }
        }
      }

      if (!result) {
        result = await adapter.publish(data.input);
        await this.publishAttempts?.markPublished(operationId, result);
      }
    }

    // Finalize the listing in the DB when a finalizer is wired: status -> live,
    // marketplaceListingId set, publishedAt recorded. ListingService.publishListing
    // persists the aggregate and emits the canonical `listing.published` event.
    if (this.listings) {
      const finalizeResult = await retryTransientPhase(
        () =>
          this.listings!.publishListing(
            data.listingId,
            result.externalListingId,
            result.publishedAt
          ),
        (attempt) => attempt.isOk(),
        (attempt) => (attempt.isErr() ? attempt.error : undefined)
      );
      if (finalizeResult.isErr()) {
        // CR3: the remote listing now EXISTS but the DB was not updated. Do not
        // swallow this and report success. Safe in-process retries are exhausted;
        // Bull resumes from the durable checkpoint without another provider POST.
        throw new ListingFinalizationError(
          data.listingId,
          data.marketplaceKey,
          result.externalListingId,
          finalizeResult.error
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
