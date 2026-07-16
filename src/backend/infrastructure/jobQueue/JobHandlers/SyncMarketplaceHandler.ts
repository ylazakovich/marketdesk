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
  getValidAccessToken(marketplaceId: string): Promise<string>;
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

export interface SyncMarketplaceHandlerDeps {
  listingStore?: SyncListingStore;
  marketplaceStore?: MarketplaceSyncStore;
  accessTokens?: SyncMarketplaceAccessTokenProvider;
  authenticatedHttpClient?: (accessToken: string) => MarketplaceHttpClient;
  eventPublisher?: IEventPublisher;
  recommendCategoryMismatch?: (input: {
    listing: Listing;
    workspaceId: string;
    currentCategory: MarketplaceCategoryMetadata | null;
    proposedCategory: MarketplaceCategoryMetadata | null;
  }) => Promise<void>;
}

export interface SyncMarketplaceJobData {
  marketplaceKey: MarketplaceKey;
  marketplaceId: string;
  externalListingIds: string[];
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
    try {
      const adapter = await this.createAdapter(data);
      const externalListingIds = await this.resolveExternalListingIds(data);
      synced = await adapter.sync(externalListingIds);
    } catch (error) {
      // Record the failed sync attempt on the marketplace before surfacing the
      // error so the Bull job fails/retries and errorCount reflects reality.
      await this.recordMarketplaceError(data.marketplaceId);
      throw error;
    }

    const persisted = await this.persistStats(data.marketplaceId, synced);
    const marketplaceUpdated = await this.recordMarketplaceSuccess(data.marketplaceId);

    return {
      marketplaceKey: data.marketplaceKey,
      synced,
      persisted,
      marketplaceUpdated,
    };
  }

  private async createAdapter(data: SyncMarketplaceJobData): Promise<IMarketplaceAdapter> {
    if (data.marketplaceKey === 'olx' && this.deps.accessTokens && this.deps.authenticatedHttpClient) {
      if (!data.marketplaceId) {
        throw new InvalidStateError('Sync job is missing marketplaceId for OLX OAuth');
      }
      const accessToken = await this.deps.accessTokens.getValidAccessToken(data.marketplaceId);
      return this.adapters.create(
        data.marketplaceKey,
        this.deps.authenticatedHttpClient(accessToken)
      );
    }
    return this.adapters.create(data.marketplaceKey);
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
    marketplaceId: string,
    synced: SyncedListing[],
  ): Promise<number> {
    const store = this.deps.listingStore;
    if (!store || synced.length === 0) return 0;

    const listings = await store.findByMarketplace(marketplaceId);
    const marketplace = await this.deps.marketplaceStore?.findById(marketplaceId);
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
    for (const s of synced) {
      const listing = byExternalId.get(s.externalListingId);
      if (!listing) continue;
      listing.recordSyncStats({
        views: s.views,
        watchers: s.watchers,
        messages: s.messages,
        remoteStatus: s.remoteStatus ?? null,
      });
      if (s.externalUrl !== undefined) {
        listing.recordExternalUrl(s.externalUrl);
      }
      if (s.marketplaceCategory !== undefined) {
        const proposedCategory = listing.marketplaceCategory;
        listing.recordMarketplaceCategory(s.marketplaceCategory);
        mismatchCandidates.push({ listing, currentCategory: s.marketplaceCategory, proposedCategory });
      }
      await this.reconcileStatus(listing, s);
      updated.push(listing);
    }

    // Build the idempotent durable mismatch pair before persisting the remote
    // category. If recommendation creation fails, a retry still sees the prior
    // verified category and can reconstruct the original mismatch.
    if (marketplace && this.deps.recommendCategoryMismatch) {
      for (const candidate of mismatchCandidates) {
        await this.deps.recommendCategoryMismatch({ ...candidate, workspaceId: marketplace.workspaceId });
      }
    }
    if (updated.length > 0) await store.saveAll(updated);
    return updated.length;
  }

  private async reconcileStatus(listing: Listing, synced: SyncedListing): Promise<void> {
    const before = listing.status;
    const remoteStatus = (synced.remoteStatus ?? synced.status).toLowerCase();
    const transition = this.transitionForRemoteStatus(remoteStatus, synced);

    if (transition === 'observe') {
      listing.recordSyncStatusNote(`Remote status observed: ${remoteStatus}`);
      return;
    }
    if (transition === 'unknown') {
      listing.recordSyncStatusNote(`Unknown remote status observed: ${remoteStatus}`);
      return;
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
      return;
    }
    if (before !== listing.status) {
      await this.publishStatusChanged(listing, before, remoteStatus);
    }
  }

  private transitionForRemoteStatus(
    remoteStatus: string,
    synced: SyncedListing,
  ): 'live' | 'expired' | 'error' | 'observe' | 'unknown' {
    if (synced.missing || remoteStatus === 'missing') return 'expired';
    if (['active', 'activated', 'live', 'published'].includes(remoteStatus)) return 'live';
    if (['new', 'moderation', 'pending', 'limited'].includes(remoteStatus)) return 'observe';
    if (['expired', 'removed', 'deactivated', 'deleted', 'closed'].includes(remoteStatus)) {
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

  private async publishStatusChanged(
    listing: Listing,
    previousStatus: string,
    remoteStatus: string,
  ): Promise<void> {
    const event: DomainEvent = {
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
    await this.deps.eventPublisher?.publish(event);
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
