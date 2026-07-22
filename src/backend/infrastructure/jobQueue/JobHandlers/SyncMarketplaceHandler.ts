// Job handler: pull current stats/status for a marketplace's listings via the
// appropriate adapter AND persist the results (C5). It resolves an adapter,
// fetches synced stats, writes them onto the matching listing aggregates, and
// records the sync outcome (lastSyncAt / errorCount reset, or errorCount++) on
// the marketplace. Depends only on injected structural ports — it does NOT
// import concrete repositories; the DI wiring supplies them in Group 6.

import type {
  IMarketplaceAdapter,
  SyncedListing,
} from '../../../domain/services/MarketplaceAdapter';
import type { MarketplaceKey, MarketplaceCategoryMetadata } from '../../../../shared/types';
import type { Listing } from '../../../domain/entities/Listing';
import type { Marketplace } from '../../../domain/entities/Marketplace';
import type { MarketplaceHttpClient } from '../../adapters/MarketplaceHttpClient';
import { InvalidStateError } from '../../../domain/shared/DomainError';
import type { DomainEvent, IEventPublisher } from '../../../domain/ports/IEventPublisher';

// Structural port for resolving an adapter by marketplace key. Satisfied by the
// MarketplaceAdapterFactory without importing it here.
export interface MarketplaceAdapterResolver {
  create(key: MarketplaceKey, http?: MarketplaceHttpClient): IMarketplaceAdapter;
}

export interface SyncMarketplaceAccessTokenProvider {
  getValidAccessTokenContext(
    marketplaceId: string,
    expectedAccount?: { id: string; revision: number },
  ): Promise<{
    accessToken: string;
    account: { id: string; revision: number };
  }>;
}

// Structural persistence ports. Satisfied by IListingRepository /
// IMarketplaceRepository without importing the concrete classes.
export interface SyncListingStore {
  findByMarketplace(marketplaceId: string): Promise<Listing[]>;
  saveAll(listings: Listing[]): Promise<void>;
}

export interface MarketplaceSyncStore {
  findById(id: string): Promise<Marketplace | null>;
  save(marketplace: Marketplace): Promise<void>;
}

export interface PendingAnalyticsEvent {
  listing: Listing;
  eventType: 'view' | 'message' | 'sale';
  quantity: number;
  idempotencyKey: string;
  occurredAt: Date;
}

export interface SyncMarketplaceHandlerDeps {
  listingStore?: SyncListingStore;
  marketplaceStore?: MarketplaceSyncStore;
  accessTokens?: SyncMarketplaceAccessTokenProvider;
  authenticatedHttpClient?: (accessToken: string) => MarketplaceHttpClient;
  eventPublisher?: IEventPublisher;
  recordAnalyticsEvents?: (input: {
    workspaceId: string;
    events: Array<{
      listing: Listing;
      eventType: 'view' | 'message' | 'sale';
      quantity: number;
      idempotencyKey: string;
      occurredAt: Date;
    }>;
  }) => Promise<void>;
  recommendCategoryMismatch?: (input: {
    listing: Listing;
    workspaceId: string;
    currentCategory: MarketplaceCategoryMetadata | null;
    proposedCategory: MarketplaceCategoryMetadata | null;
    marketplaceAccount: { id: string; revision: number };
  }) => Promise<void>;
  persistAndReconcileProductCategories?: (input: {
    marketplace: Marketplace;
    listings: Listing[];
    expectedUpdatedAt: ReadonlyMap<string, Date>;
    mismatchCandidates: Array<{
      listing: Listing;
      currentCategory: MarketplaceCategoryMetadata | null;
      proposedCategory: MarketplaceCategoryMetadata | null;
    }>;
    marketplaceAccount: { id: string; revision: number } | null;
    analyticsEvents: PendingAnalyticsEvent[];
    job: SyncMarketplaceJobData;
  }) => Promise<void>;
}

export interface SyncMarketplaceJobData {
  marketplaceKey: MarketplaceKey;
  marketplaceId: string;
  externalListingIds: string[];
  trigger?: 'manual' | 'scheduled';
  actorId?: string;
}

export interface SyncMarketplaceResult {
  marketplaceKey: MarketplaceKey;
  synced: SyncedListing[];
  // Number of internal listing aggregates whose stats were persisted.
  persisted: number;
  // Whether the marketplace's sync bookkeeping (lastSyncAt/errorCount) was updated.
  marketplaceUpdated: boolean;
}

export class SyncMarketplaceHandler {
  constructor(
    private readonly adapters: MarketplaceAdapterResolver,
    private readonly deps: SyncMarketplaceHandlerDeps = {},
  ) {}

  async handle(data: SyncMarketplaceJobData): Promise<SyncMarketplaceResult> {
    let synced: SyncedListing[];
    let marketplaceAccount: { id: string; revision: number } | null = null;
    try {
      const resolved = await this.createAdapter(data);
      const adapter = resolved.adapter;
      marketplaceAccount = resolved.marketplaceAccount;
      const externalListingIds = await this.resolveExternalListingIds(data);
      synced = await adapter.sync(externalListingIds);
    } catch (error) {
      // Record the failed sync attempt on the marketplace before surfacing the
      // error so the Bull job fails/retries and errorCount reflects reality.
      await this.recordMarketplaceError(data.marketplaceId);
      throw error;
    }

    const persisted = await this.persistStats(data, synced, marketplaceAccount);
    const marketplaceUpdated = await this.recordMarketplaceSuccess(data.marketplaceId);

    return {
      marketplaceKey: data.marketplaceKey,
      synced,
      persisted,
      marketplaceUpdated,
    };
  }

  private async createAdapter(data: SyncMarketplaceJobData): Promise<{
    adapter: IMarketplaceAdapter;
    marketplaceAccount: { id: string; revision: number } | null;
  }> {
    const marketplace = await this.deps.marketplaceStore?.findById(data.marketplaceId);
    if (this.deps.marketplaceStore && !marketplace) {
      throw new InvalidStateError(`Marketplace not found for sync job: ${data.marketplaceId}`);
    }
    if (marketplace && marketplace.key !== data.marketplaceKey) {
      throw new InvalidStateError('Sync job marketplace key does not match persisted marketplace');
    }
    if (data.marketplaceKey === 'olx' && this.deps.accessTokens && this.deps.authenticatedHttpClient) {
      if (!data.marketplaceId) {
        throw new InvalidStateError('Sync job is missing marketplaceId for OLX OAuth');
      }
      const resolved = await this.deps.accessTokens.getValidAccessTokenContext(data.marketplaceId);
      return {
        adapter: this.adapters.create(
          data.marketplaceKey,
          this.deps.authenticatedHttpClient(resolved.accessToken)
        ),
        marketplaceAccount: resolved.account,
      };
    }
    return { adapter: this.adapters.create(data.marketplaceKey), marketplaceAccount: null };
  }

  private async resolveExternalListingIds(data: SyncMarketplaceJobData): Promise<string[]> {
    if (data.externalListingIds.length > 0) return data.externalListingIds;
    const store = this.deps.listingStore;
    if (!store) return [];
    const listings = await store.findByMarketplace(data.marketplaceId);
    return listings
      .map((listing) => listing.marketplaceListingId)
      .filter((id): id is string => id !== null && id.length > 0);
  }

  // Write fetched engagement stats and reconcile safe remote lifecycle states.
  // Transient/unknown provider states are recorded as sync notes instead of
  // forcing destructive local transitions.
  private async persistStats(
    data: SyncMarketplaceJobData,
    synced: SyncedListing[],
    marketplaceAccount: { id: string; revision: number } | null,
  ): Promise<number> {
    const store = this.deps.listingStore;
    if (!store || synced.length === 0) return 0;

    const listings = await store.findByMarketplace(data.marketplaceId);
    const expectedUpdatedAt = new Map(listings.map((listing) => [listing.id, listing.updatedAt]));
    const marketplace = await this.deps.marketplaceStore?.findById(data.marketplaceId);
    const byExternalId = new Map<string, Listing>();
    for (const listing of listings) {
      if (listing.marketplaceListingId) {
        byExternalId.set(listing.marketplaceListingId, listing);
      }
    }

    const updated: Listing[] = [];
    const mismatchCandidates: Array<{
      listing: Listing;
      currentCategory: MarketplaceCategoryMetadata | null;
      proposedCategory: MarketplaceCategoryMetadata | null;
    }> = [];
    const statusEvents: DomainEvent[] = [];
    const analyticsEvents: PendingAnalyticsEvent[] = [];
    const occurredAt = new Date();
    for (const s of synced) {
      const listing = byExternalId.get(s.externalListingId);
      if (!listing) continue;
      const nextViews = Number(s.views ?? listing.views ?? 0);
      const nextMessages = Number(s.messages ?? listing.messages ?? 0);
      const viewDelta = Math.max(0, nextViews - Number(listing.views ?? 0));
      const messageDelta = Math.max(0, nextMessages - Number(listing.messages ?? 0));
      if (viewDelta > 0) analyticsEvents.push({
        listing, eventType: 'view', quantity: viewDelta,
        idempotencyKey: `sync:view:${listing.id}:${nextViews}`, occurredAt,
      });
      if (messageDelta > 0) analyticsEvents.push({
        listing, eventType: 'message', quantity: messageDelta,
        idempotencyKey: `sync:message:${listing.id}:${nextMessages}`, occurredAt,
      });
      const remoteStatus = (s.remoteStatus ?? s.status).toLowerCase();
      if (['sold', 'completed'].includes(remoteStatus) && listing.status !== 'expired') {
        analyticsEvents.push({
          listing, eventType: 'sale', quantity: 1,
          idempotencyKey: `sync:sale:${listing.id}:${remoteStatus}`, occurredAt,
        });
      }
      listing.recordSyncStats({
        views: s.views,
        watchers: s.watchers,
        messages: s.messages,
        remoteStatus: s.remoteStatus ?? null,
      });
      if (s.messageMetricStatus === 'unavailable') {
        listing.recordMessagesUnavailable();
      }
      if (s.externalUrl !== undefined) {
        listing.recordExternalUrl(s.externalUrl);
      }
      if (s.marketplaceCategory !== undefined) {
        const proposedCategory = listing.marketplaceCategory;
        listing.recordMarketplaceCategory(s.marketplaceCategory);
        mismatchCandidates.push({ listing, currentCategory: s.marketplaceCategory, proposedCategory });
      }
      const statusEvent = this.reconcileStatus(listing, s);
      if (statusEvent) statusEvents.push(statusEvent);
      if (s.messageMetricStatus === 'error') {
        const messageMetricNote = 'Message metric is stale: thread metadata could not be processed';
        listing.recordSyncStatusNote(
          listing.syncError ? `${listing.syncError}; ${messageMetricNote}` : messageMetricNote,
        );
      }
      updated.push(listing);
    }

    let reconciliationAccount: { id: string; revision: number } | null = marketplaceAccount;
    if (marketplace && mismatchCandidates.length > 0 && this.deps.accessTokens) {
      const resolved = await this.deps.accessTokens.getValidAccessTokenContext(
        marketplace.id,
        marketplaceAccount ?? undefined,
      );
      reconciliationAccount = resolved.account;
    }

    if (updated.length > 0) {
      if (marketplace && this.deps.persistAndReconcileProductCategories) {
        await this.deps.persistAndReconcileProductCategories({
          marketplace,
          listings: updated,
          expectedUpdatedAt,
          mismatchCandidates,
          marketplaceAccount: reconciliationAccount,
          analyticsEvents,
          job: data,
        });
      } else {
        await store.saveAll(updated);
        // Custom/non-PostgreSQL stores cannot share the production transaction.
        // Append after the durable listing checkpoint so a failed save cannot
        // overcount the same remote delta on retry.
        if (marketplace && analyticsEvents.length > 0) {
          await this.deps.recordAnalyticsEvents?.({
            workspaceId: marketplace.workspaceId,
            events: analyticsEvents,
          });
        }
        if (marketplace && this.deps.recommendCategoryMismatch) {
          if (!reconciliationAccount) {
            throw new InvalidStateError(
              'Marketplace account binding is required before category reconciliation'
            );
          }
          for (const candidate of mismatchCandidates) {
            await this.deps.recommendCategoryMismatch({
              ...candidate,
              workspaceId: marketplace.workspaceId,
              marketplaceAccount: reconciliationAccount,
            });
          }
        }
      }
    }
    for (const event of statusEvents) {
      try {
        await this.deps.eventPublisher?.publish(event);
      } catch {
        // Listing state is already committed; lifecycle delivery is best-effort.
      }
    }
    return updated.length;
  }

  private reconcileStatus(listing: Listing, synced: SyncedListing): DomainEvent | null {
    const before = listing.status;
    const remoteStatus = (synced.remoteStatus ?? synced.status).toLowerCase();
    const transition = this.transitionForRemoteStatus(remoteStatus, synced);

    if (transition === 'observe') {
      listing.recordSyncStatusNote(`Remote status observed: ${remoteStatus}`);
      return null;
    }
    if (transition === 'unknown') {
      listing.recordSyncStatusNote(`Unknown remote status observed: ${remoteStatus}`);
      return null;
    }

    let result;
    if (transition === 'live') {
      listing.recordSyncStatusNote(null);
      if (listing.status !== 'live') result = listing.relist();
    } else if (transition === 'expired') {
      if (listing.status !== 'expired') result = listing.expire();
      listing.recordSyncStatusNote(
        synced.missing
          ? 'Remote advert missing during sync'
          : `Remote advert is ${remoteStatus}`,
      );
    } else if (transition === 'error') {
      result = listing.markError(`Remote advert is ${remoteStatus}`);
    }

    if (result?.isErr()) {
      listing.recordSyncStatusNote(
        `Remote status ${remoteStatus} could not be applied from local status ${before}: ${result.error.message}`,
      );
      return null;
    }
    return before !== listing.status
      ? this.statusChangedEvent(listing, before, remoteStatus)
      : null;
  }

  private transitionForRemoteStatus(
    remoteStatus: string,
    synced: SyncedListing,
  ): 'live' | 'expired' | 'error' | 'observe' | 'unknown' {
    if (synced.missing || remoteStatus === 'missing') return 'expired';
    if (['active', 'activated', 'live', 'published'].includes(remoteStatus)) return 'live';
    if (['new', 'moderation', 'pending', 'limited'].includes(remoteStatus)) return 'observe';
    if (['expired', 'removed', 'deactivated', 'deleted', 'closed', 'sold', 'completed'].includes(remoteStatus)) {
      return 'expired';
    }
    if (['rejected', 'blocked', 'error'].includes(remoteStatus)) return 'error';
    if (synced.remoteStatus === undefined) {
      switch (synced.status) {
        case 'live':
          return 'live';
        case 'expired':
          return 'expired';
        case 'error':
          return 'error';
        case 'draft':
          return 'observe';
      }
    }
    return 'unknown';
  }

  private statusChangedEvent(
    listing: Listing,
    previousStatus: string,
    remoteStatus: string,
  ): DomainEvent {
    return {
      type: 'listing.remote_status_reconciled',
      aggregateType: 'Listing',
      aggregateId: listing.id,
      payload: {
        listingId: listing.id,
        marketplaceId: listing.marketplaceId,
        marketplaceListingId: listing.marketplaceListingId,
        previousStatus,
        status: listing.status,
        remoteStatus,
      },
      occurredAt: new Date(),
    };
  }

  private async recordMarketplaceSuccess(marketplaceId: string): Promise<boolean> {
    const store = this.deps.marketplaceStore;
    if (!store) return false;
    const marketplace = await store.findById(marketplaceId);
    if (!marketplace) return false;
    marketplace.recordSyncSuccess();
    await store.save(marketplace);
    return true;
  }

  private async recordMarketplaceError(marketplaceId: string): Promise<void> {
    const store = this.deps.marketplaceStore;
    if (!store) return;
    const marketplace = await store.findById(marketplaceId);
    if (!marketplace) return;
    marketplace.recordSyncError();
    await store.save(marketplace);
  }
}
