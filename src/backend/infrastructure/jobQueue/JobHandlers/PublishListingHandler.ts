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
import { GuardrailViolationError, InvalidStateError, ServiceUnavailableError } from '../../../domain/shared/DomainError';
import type { OlxQuotaDecisionView } from '../../../application/services/OlxPublicationQuotaService';
import type {
  ListingPublishJobInput,
  ListingUpdateJobChanges,
  PublishListingJob,
} from '../../../application/ports/IJobQueue';
import { MarketplaceError } from '../../adapters/MarketplaceError';

export type PublishListingJobData = PublishListingJob;

function isTransientInfrastructureError(error: unknown): boolean {
  if (error instanceof MarketplaceError && error.retryable) return true;
  if (error instanceof ServiceUnavailableError) return true;
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code ?? '');
  return (
    code.startsWith('08') ||
    [
      '40001',
      '40P01',
      '55P03',
      '57P01',
      '57P02',
      '57P03',
      'ECONNRESET',
      'ETIMEDOUT',
      'EPIPE',
    ].includes(code)
  );
}

function shouldAbandonUpdateCheckpoint(error: unknown): boolean {
  return !isTransientInfrastructureError(error);
}

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
      if (!isTransientInfrastructureError(failure(lastValue))) return lastValue;
    } catch (error) {
      if (!isTransientInfrastructureError(error) || attempt === attempts) throw error;
    }
    await sleep(50 * 2 ** (attempt - 1));
  }
  return lastValue as T;
}

const UPDATE_CHANGE_KEYS = ['productName', 'description', 'price'] as const;

function isUpdateChangeKey(key: string): key is (typeof UPDATE_CHANGE_KEYS)[number] {
  return (UPDATE_CHANGE_KEYS as readonly string[]).includes(key);
}

function validatedUpdateChanges(changes: unknown): ListingUpdateJobChanges {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new InvalidStateError('Update job changes must be an object');
  }
  const record = changes as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.some((key) => !isUpdateChangeKey(key))) {
    throw new InvalidStateError(
      'Update job changes may only include productName, description, or price'
    );
  }
  if ('productName' in record && typeof record.productName !== 'string') {
    throw new InvalidStateError('Update job productName must be a string');
  }
  if ('description' in record && typeof record.description !== 'string') {
    throw new InvalidStateError('Update job description must be a string');
  }
  if ('price' in record && (typeof record.price !== 'number' || !Number.isFinite(record.price))) {
    throw new InvalidStateError('Update job price must be a finite number');
  }
  return Object.fromEntries(
    UPDATE_CHANGE_KEYS.filter((key) => key in record).map((key) => [key, record[key]])
  ) as unknown as ListingUpdateJobChanges;
}

export interface PublishAttemptCheckpoint {
  operationId: string;
  listingId: string;
  listingUpdatedAt: Date;
  marketplaceKey: MarketplaceKey;
  status: 'publishing' | 'published' | 'finalized' | 'abandoned';
  externalListingId: string | null;
  externalUrl: string | null;
  publishedAt: Date | null;
  remoteStatus: string | null;
  remoteImageUrls: string[];
}

export interface PublishAttemptStore {
  find(operationId: string): Promise<PublishAttemptCheckpoint | null>;
  begin(
    operationId: string,
    listingId: string,
    marketplaceKey: MarketplaceKey,
    listingUpdatedAt: Date
  ): Promise<{ created: boolean; checkpoint: PublishAttemptCheckpoint }>;
  markPublished(operationId: string, result: PublishResult): Promise<void>;
  markFinalized(operationId: string): Promise<void>;
  markAbandoned(operationId: string): Promise<void>;
}

export interface PublishQuotaReservationConsumer {
  consumeReservation(operationId: string): Promise<OlxQuotaDecisionView>;
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
    externalUrl?: string | null,
    publishedAt?: Date,
    expiresAt?: Date | null,
    remoteStatus?: string | null,
    remoteImageUrls?: string[]
  ): Promise<Result<Listing>>;
  // Optional idempotency probe: reports whether the listing was already published
  // (live + marketplaceListingId set) by a prior attempt. Lets the handler skip the
  // non-idempotent adapter publish on retry so it never creates a duplicate remote
  // listing (see CR2/CR3). When absent, the handler always publishes.
  getPublishState?(listingId: string): Promise<{
    isPublished: boolean;
    externalListingId: string | null;
    externalUrl: string | null;
    publishedAt: Date | null;
    updatedAt?: Date | null;
    productUpdatedAt?: Date | null;
    currentInput?: ListingPublishJobInput;
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
    private readonly publishAttempts?: PublishAttemptStore,
    private readonly olxQuota?: PublishQuotaReservationConsumer
  ) {}

  async handle(data: PublishListingJobData): Promise<PublishListingResult> {
    // Backward-compatible fallback for jobs that were already queued before
    // operationId became part of the payload. New enqueue paths always set it.
    const operationId = data.operationId ?? data.listingId;
    if (data.mode === 'update') {
      const changes = validatedUpdateChanges(data.changes);
      const state = await this.listings?.getPublishState?.(data.listingId);
      if (!state?.isPublished || !state.externalListingId) {
        throw new InvalidStateError(
          `Listing ${data.listingId} must be live with an external id before marketplace update`
        );
      }
      if (!state.currentInput) {
        throw new InvalidStateError(
          `Listing ${data.listingId} update state is missing the current product snapshot`
        );
      }
      if (
        ('productName' in changes && changes.productName !== state.currentInput.productName) ||
        ('description' in changes && changes.description !== state.currentInput.description) ||
        ('price' in changes && changes.price !== state.currentInput.price)
      ) {
        throw new InvalidStateError(
          `Listing ${data.listingId} or its product has changed since this marketplace update was queued`
        );
      }
      if (!this.publishAttempts) {
        throw new InvalidStateError('Update handler is missing the durable operation store');
      }
      const listingGeneration = new Date(data.listingUpdatedAt ?? '');
      const productGeneration = data.productUpdatedAt
        ? new Date(data.productUpdatedAt)
        : listingGeneration;
      if (
        !Number.isFinite(listingGeneration.getTime()) ||
        (data.productUpdatedAt && !Number.isFinite(productGeneration.getTime()))
      ) {
        throw new InvalidStateError('Update job has an invalid listing/product generation');
      }
      const updateGeneration = new Date(
        Math.max(listingGeneration.getTime(), productGeneration.getTime())
      );
      const claimUpdate = () =>
        retryTransientPhase(() =>
          this.publishAttempts!.begin(
            operationId,
            data.listingId,
            data.marketplaceKey,
            updateGeneration
          )
        );
      let claim = await claimUpdate();
      if (
        !claim.created &&
        claim.checkpoint.status === 'published' &&
        claim.checkpoint.listingUpdatedAt.getTime() < updateGeneration.getTime()
      ) {
        await retryTransientPhase(() =>
          this.publishAttempts!.markFinalized(claim.checkpoint.operationId)
        );
        claim = await claimUpdate();
      }
      if (!claim.created) {
        const sameOperation = claim.checkpoint.operationId === operationId;
        if (claim.checkpoint.status === 'published' || claim.checkpoint.status === 'finalized') {
          if (claim.checkpoint.status !== 'finalized') {
            await retryTransientPhase(() =>
              this.publishAttempts!.markFinalized(claim.checkpoint.operationId)
            );
          }
          return {
            marketplaceKey: data.marketplaceKey,
            listingId: data.listingId,
            result: {
              externalListingId: state.externalListingId,
              externalUrl: state.externalUrl,
              publishedAt: state.publishedAt ?? new Date(),
            },
            finalized: true,
          };
        }
        if (!sameOperation) {
          throw new InvalidStateError(
            `Listing ${data.listingId} has another marketplace update in progress`
          );
        }
      }

      let adapter: IMarketplaceAdapter;
      if (data.marketplaceKey === 'olx') {
        if (!this.accessTokens || !this.authenticatedHttpClient) {
          throw new InvalidStateError('OLX update handler is missing OAuth dependencies');
        }
        if (!data.marketplaceId) {
          throw new InvalidStateError('Update job is missing marketplaceId for OLX OAuth');
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

      const updateResult: PublishResult = {
        externalListingId: state.externalListingId,
        externalUrl: state.externalUrl,
        publishedAt: state.publishedAt ?? new Date(),
      };
      try {
        await adapter.updateListing(state.externalListingId, changes, state.currentInput);
      } catch (error) {
        if (shouldAbandonUpdateCheckpoint(error)) {
          try {
            await retryTransientPhase(() => this.publishAttempts!.markAbandoned(operationId));
          } catch {
            // Preserve the original marketplace update failure for retry/error handling.
          }
        }
        throw error;
      }
      await retryTransientPhase(() =>
        this.publishAttempts!.markPublished(operationId, updateResult)
      );
      await retryTransientPhase(() => this.publishAttempts!.markFinalized(operationId));

      return {
        marketplaceKey: data.marketplaceKey,
        listingId: data.listingId,
        result: updateResult,
        finalized: true,
      };
    }
    let checkpointOperationId = operationId;
    const checkpoint = await this.publishAttempts?.find(operationId);
    let checkpointFinalized = checkpoint?.status === 'finalized';
    // A same-operation retry after finalization can safely complete the checkpoint.
    // A fresh relist intentionally bypasses the generic "already live" shortcut.
    if (this.listings?.getPublishState) {
      const state = await this.listings.getPublishState(data.listingId);
      if (state?.isPublished && state.externalListingId) {
        const sameCheckpoint =
          checkpoint?.externalListingId === state.externalListingId &&
          (checkpoint.status === 'published' || checkpoint.status === 'finalized');
        if (sameCheckpoint || data.mode !== 'relist') {
          if (sameCheckpoint && checkpoint.status !== 'finalized') {
            await retryTransientPhase(() => this.publishAttempts!.markFinalized(operationId));
          }
          return {
            marketplaceKey: data.marketplaceKey,
            listingId: data.listingId,
            result: {
              externalListingId: state.externalListingId,
              externalUrl: checkpoint?.externalUrl ?? state.externalUrl ?? null,
              publishedAt: state.publishedAt ?? new Date(),
              remoteStatus: checkpoint?.remoteStatus ?? null,
              remoteImageUrls: checkpoint?.remoteImageUrls ?? [],
            },
            finalized: true,
          };
        }
      }
    }

    let result: PublishResult | undefined;
    if (
      (checkpoint?.status === 'published' || checkpoint?.status === 'finalized') &&
      checkpoint.externalListingId
    ) {
      result = {
        externalListingId: checkpoint.externalListingId,
        externalUrl: checkpoint.externalUrl,
        publishedAt: checkpoint.publishedAt ?? new Date(),
        remoteStatus: checkpoint.remoteStatus ?? null,
        remoteImageUrls: checkpoint.remoteImageUrls ?? [],
      };
    } else if (checkpoint?.status === 'publishing') {
      throw new InvalidStateError(
        `Listing ${data.listingId} has an ambiguous in-flight marketplace publish; reconcile it before retrying`
      );
    }

    if (!result) {
      let ownsNewAttempt = false;
      if (data.marketplaceKey === 'olx' && (!this.olxQuota || !this.publishAttempts)) {
        throw new InvalidStateError(
          'OLX publish worker is missing a quota reservation or publication fence',
        );
      }
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
      const preparedPublish = adapter.preparePublish
        ? await adapter.preparePublish(data.input)
        : { execute: () => adapter.publish(data.input) };

      if (this.publishAttempts) {
        const started = await this.publishAttempts.begin(
          operationId,
          data.listingId,
          data.marketplaceKey,
          new Date(data.listingUpdatedAt ?? 0)
        );
        ownsNewAttempt = started.created;
        if (!started.created) {
          checkpointOperationId = started.checkpoint.operationId;
          checkpointFinalized = started.checkpoint.status === 'finalized';
          if (
            (started.checkpoint.status === 'published' ||
              started.checkpoint.status === 'finalized') &&
            started.checkpoint.externalListingId
          ) {
            result = {
              externalListingId: started.checkpoint.externalListingId,
              externalUrl: started.checkpoint.externalUrl,
              publishedAt: started.checkpoint.publishedAt ?? new Date(),
              remoteStatus: started.checkpoint.remoteStatus ?? null,
              remoteImageUrls: started.checkpoint.remoteImageUrls ?? [],
            };
          } else {
            throw new InvalidStateError(
              `Listing ${data.listingId} has an ambiguous in-flight marketplace publish; reconcile it before retrying`
            );
          }
        }
      }

      if (!result) {
        if (data.marketplaceKey === 'olx') {
          if (!this.olxQuota || !this.publishAttempts || !ownsNewAttempt) {
            throw new InvalidStateError('OLX publish worker is missing a quota reservation or publication fence');
          }
          try {
            const quotaDecision = await this.olxQuota.consumeReservation(operationId);
            if (quotaDecision.decision !== 'allow' && quotaDecision.decision !== 'override') {
              throw new GuardrailViolationError(
                `OLX ${quotaDecision.status} quota blocks publication`,
                { quotaDecision },
              );
            }
          } catch (error) {
            await this.publishAttempts.markAbandoned(operationId);
            throw error;
          }
        }
        result = await preparedPublish.execute();
        if (this.publishAttempts) {
          await retryTransientPhase(() =>
            this.publishAttempts!.markPublished(operationId, result!)
          );
        }
      }
    }

    if (checkpointFinalized) {
      return {
        marketplaceKey: data.marketplaceKey,
        listingId: data.listingId,
        result,
        finalized: true,
      };
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
            result.externalUrl ?? null,
            result.publishedAt,
            null,
            result.remoteStatus ?? null,
            result.remoteImageUrls ?? []
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
      if (this.publishAttempts) {
        await retryTransientPhase(() => this.publishAttempts!.markFinalized(checkpointOperationId));
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
          externalUrl: result.externalUrl ?? null,
        },
        occurredAt: new Date(),
      });
    }
    if (this.publishAttempts) {
      await retryTransientPhase(() => this.publishAttempts!.markFinalized(checkpointOperationId));
    }

    return {
      marketplaceKey: data.marketplaceKey,
      listingId: data.listingId,
      result,
      finalized: false,
    };
  }
}
