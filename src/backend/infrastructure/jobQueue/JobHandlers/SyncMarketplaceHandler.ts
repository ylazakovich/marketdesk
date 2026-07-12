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
import type { MarketplaceKey } from '../../../../shared/types';
import type { Listing } from '../../../domain/entities/Listing';
import type { Marketplace } from '../../../domain/entities/Marketplace';

// Structural port for resolving an adapter by marketplace key. Satisfied by the
// MarketplaceAdapterFactory without importing it here.
export interface MarketplaceAdapterResolver {
  create(key: MarketplaceKey): IMarketplaceAdapter;
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
    const adapter = this.adapters.create(data.marketplaceKey);

    let synced: SyncedListing[];
    try {
      synced = await adapter.sync(data.externalListingIds);
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

  // Write fetched engagement stats onto the matching listing aggregates.
  // NOTE (deferred): listing STATUS reconciliation from the synced status
  // (e.g. remote 'expired'/'error' -> local expire()/markError()) is not applied
  // here yet — only the engagement counters + lastSyncAt are persisted. Status
  // transitions are handled by the dedicated publish/relist/expire flows.
  private async persistStats(
    marketplaceId: string,
    synced: SyncedListing[],
  ): Promise<number> {
    const store = this.deps.listingStore;
    if (!store || synced.length === 0) return 0;

    const listings = await store.findByMarketplace(marketplaceId);
    const byExternalId = new Map<string, Listing>();
    for (const listing of listings) {
      if (listing.marketplaceListingId) {
        byExternalId.set(listing.marketplaceListingId, listing);
      }
    }

    const updated: Listing[] = [];
    for (const s of synced) {
      const listing = byExternalId.get(s.externalListingId);
      if (!listing) continue;
      listing.recordSyncStats({
        views: s.views,
        watchers: s.watchers,
        messages: s.messages,
      });
      updated.push(listing);
    }

    if (updated.length > 0) await store.saveAll(updated);
    return updated.length;
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
