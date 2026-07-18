// Abstract base for all marketplace adapters. Implements the domain
// IMarketplaceAdapter port and centralizes the cross-cutting concerns every
// marketplace shares: retry with backoff, rate-limit handling, and error
// normalization. Concrete adapters implement only the marketplace-specific
// mapping (the do* methods) — they never worry about retries or error shapes.

import type {
  IMarketplaceAdapter,
  ImportDiscoveryOptions,
  ImportedMarketplaceListing,
  ListingPublishInput,
  PublishResult,
  SyncedListing,
} from '../../domain/services/MarketplaceAdapter';
import type { MarketplaceKey, ListingStatus } from '../../../shared/types';
import type { MarketplaceHttpClient } from './MarketplaceHttpClient';
import { HttpError } from './MarketplaceHttpClient';
import {
  MarketplaceError,
  MarketplaceAuthenticationError,
  MarketplaceNotFoundError,
  MarketplaceProviderRejectionError,
  MarketplaceRateLimitError,
  MarketplaceTransientError,
  MarketplaceUnknownError,
} from './MarketplaceError';

export interface MarketplaceAdapterOptions {
  // Max number of retry attempts for retryable failures (rate limit / 5xx).
  maxRetries?: number;
  // Base delay (ms) for exponential backoff. Kept tiny by default so tests are fast.
  baseRetryDelayMs?: number;
  // Injectable sleep so tests don't wait on real timers.
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const SENSITIVE_PROVIDER_KEYS =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|password|phone|e[-_]?mail)/i;

function sanitizeProviderBody(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeProviderBody(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_PROVIDER_KEYS.test(key) ? '[REDACTED]' : sanitizeProviderBody(item, depth + 1),
      ]),
    );
  }
  return typeof value === 'string' && value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

function providerErrorSuffix(body: unknown): string {
  if (body === undefined || body === null || body === '') return '';
  try {
    const detail = JSON.stringify(sanitizeProviderBody(body));
    return detail ? `: ${detail.slice(0, 2_000)}` : '';
  } catch {
    return '';
  }
}

export abstract class BaseMarketplaceAdapter implements IMarketplaceAdapter {
  protected readonly maxRetries: number;
  protected readonly baseRetryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  protected constructor(
    protected readonly http: MarketplaceHttpClient,
    private readonly key: MarketplaceKey,
    options: MarketplaceAdapterOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 2;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 50;
    this.sleep = options.sleep ?? defaultSleep;
  }

  getKey(): MarketplaceKey {
    return this.key;
  }

  // --- Public port surface (retry + error-normalized) ---

  // publish() issues a POST that CREATES a remote listing — it is NOT idempotent.
  // If an ambiguous failure occurs (a 5xx/429/timeout where the marketplace may
  // have already created the listing but the response was lost), a blind retry
  // would re-POST and create a DUPLICATE listing. So publish never auto-retries;
  // an ambiguous failure surfaces to the caller (the job layer) which can decide
  // to finalize/reconcile without re-publishing. The idempotent operations below
  // (update/delist/sync/fetch) are safe to retry.
  publish(input: ListingPublishInput): Promise<PublishResult> {
    return this.execute('publish', () => this.doPublish(input), { retry: false });
  }

  async preparePublish(input: ListingPublishInput): Promise<{ execute(): Promise<PublishResult> }> {
    return { execute: () => this.publish(input) };
  }

  updateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
    current: ListingPublishInput,
  ): Promise<void> {
    return this.execute('updateListing', () =>
      this.doUpdateListing(externalListingId, changes, current),
    );
  }

  delist(externalListingId: string): Promise<void> {
    return this.execute('delist', () => this.doDelist(externalListingId), { retry: false });
  }

  sync(externalListingIds: string[]): Promise<SyncedListing[]> {
    if (externalListingIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.execute('sync', () => this.doSync(externalListingIds));
  }

  fetchListing(externalListingId: string): Promise<SyncedListing | null> {
    return this.execute('fetchListing', () => this.doFetchListing(externalListingId));
  }

  listOwnedListings(options?: ImportDiscoveryOptions): Promise<ImportedMarketplaceListing[]> {
    return this.execute('listOwnedListings', () => this.doListOwnedListings(options));
  }

  // --- Marketplace-specific hooks (implemented by concrete adapters) ---

  protected abstract doPublish(input: ListingPublishInput): Promise<PublishResult>;
  protected abstract doUpdateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
    current: ListingPublishInput,
  ): Promise<void>;
  protected abstract doDelist(externalListingId: string): Promise<void>;
  protected abstract doSync(externalListingIds: string[]): Promise<SyncedListing[]>;
  protected abstract doFetchListing(
    externalListingId: string,
  ): Promise<SyncedListing | null>;
  protected async doListOwnedListings(
    _options?: ImportDiscoveryOptions,
  ): Promise<ImportedMarketplaceListing[]> {
    return [];
  }

  // Translate a marketplace-specific status string to the domain ListingStatus.
  // Overridable; the default is a conservative best-effort mapping.
  protected mapStatus(raw: string): ListingStatus {
    switch (raw?.toLowerCase()) {
      case 'active':
      case 'live':
      case 'published':
        return 'live';
      case 'draft':
      case 'pending':
      case 'unpublished':
        return 'draft';
      case 'expired':
      case 'ended':
      case 'closed':
        return 'expired';
      case 'error':
      case 'rejected':
      case 'blocked':
        return 'error';
      default:
        return 'draft';
    }
  }

  // --- Shared execution: retry retryable failures, normalize everything else ---

  // `retry: false` disables retries entirely for non-idempotent operations
  // (e.g. publish) so an ambiguous failure never re-issues the side effect.
  protected async execute<T>(
    operation: string,
    fn: () => Promise<T>,
    opts: { retry?: boolean } = {},
  ): Promise<T> {
    const maxRetries = opts.retry === false ? 0 : this.maxRetries;
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (raw) {
        const err = this.normalizeError(raw, operation);
        if (err.retryable && attempt < maxRetries) {
          attempt += 1;
          await this.sleep(this.baseRetryDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw err;
      }
    }
  }

  // Normalize any thrown value into a MarketplaceError. Already-normalized errors
  // pass through unchanged.
  protected normalizeError(raw: unknown, operation: string): MarketplaceError {
    if (raw instanceof MarketplaceError) {
      return raw;
    }
    const label = `${this.key}:${operation}`;
    if (raw instanceof HttpError) {
      if (raw.status === 401 || raw.status === 403) {
        return new MarketplaceAuthenticationError(`${label}: invalid credentials`, raw);
      }
      if (raw.status === 404) {
        return new MarketplaceNotFoundError(`${label}: resource not found`, raw);
      }
      if (raw.status === 408) {
        return new MarketplaceTransientError(`${label}: request timed out`, raw);
      }
      if (raw.status === 429) {
        return new MarketplaceRateLimitError(`${label}: rate limit exceeded`, raw);
      }
      if (raw.status >= 500) {
        return new MarketplaceTransientError(`${label}: upstream error ${raw.status}`, raw);
      }
      return new MarketplaceProviderRejectionError(
        `${label}: HTTP ${raw.status}${providerErrorSuffix(raw.body)}`,
        raw,
      );
    }
    const message = raw instanceof Error ? raw.message : String(raw);
    return new MarketplaceUnknownError(`${label}: ${message}`, raw);
  }
}
