// Marketplace-agnostic adapter PORT (interface only). Concrete adapters
// (OLXAdapter, AllegroAdapter, ...) are implemented in infrastructure (Group 3B).
// The domain stays completely agnostic to marketplace specifics.

import type { MarketplaceKey, ListingStatus, MarketplaceCategoryMetadata } from '../../../shared/types';

export interface ListingPublishInput {
  productName: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  marketplaceCategory?: MarketplaceCategoryMetadata | null;
  condition: string;
  imageUrls: string[];
}

export interface PublishResult {
  externalListingId: string;
  externalUrl?: string | null;
  publishedAt: Date;
  remoteStatus?: string | null;
  remoteImageUrls?: string[];
}
export interface PreparedMarketplacePublish {
  execute(): Promise<PublishResult>;
}

export interface SyncedListing {
  externalListingId: string;
  externalUrl?: string | null;
  status: ListingStatus;
  remoteStatus?: string;
  missing?: boolean;
  views?: number | null;
  watchers?: number | null;
  messages?: number | null;
  messageMetricStatus?: 'available' | 'unavailable' | 'error';
  marketplaceCategory?: MarketplaceCategoryMetadata | null;
}

export interface ImportedMarketplaceListing {
  externalListingId: string;
  externalUrl?: string | null;
  title: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  status: ListingStatus;
  remoteStatus?: string | null;
  category?: string | null;
  marketplaceCategory?: MarketplaceCategoryMetadata | null;
  imageUrls: string[];
  remoteUpdatedAt?: Date | null;
  metrics?: { views?: number; watchers?: number; messages?: number };
}

export interface ImportDiscoveryOptions {
  pageSize?: number;
  statuses?: string[];
}

export interface IMarketplaceAdapter {
  getKey(): MarketplaceKey;

  // Publish a new listing to the marketplace.
  publish(input: ListingPublishInput): Promise<PublishResult>;
  // Validate and prepare all local provider payload state before a durable
  // publication fence is claimed. execute() begins the provider request.
  preparePublish?(input: ListingPublishInput): Promise<PreparedMarketplacePublish>;

  // Update fields of an existing marketplace listing.
  updateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
    current: ListingPublishInput,
  ): Promise<void>;

  // Remove/unpublish a listing.
  delist(externalListingId: string): Promise<void>;

  // Pull current stats/status for the given external listing ids.
  sync(externalListingIds: string[]): Promise<SyncedListing[]>;

  // Fetch a single listing's current state.
  fetchListing(externalListingId: string): Promise<SyncedListing | null>;

  // Read-only discovery of adverts owned by the connected marketplace account.
  listOwnedListings(options?: ImportDiscoveryOptions): Promise<ImportedMarketplaceListing[]>;
}
