// Marketplace-agnostic adapter PORT (interface only). Concrete adapters
// (OLXAdapter, AllegroAdapter, ...) are implemented in infrastructure (Group 3B).
// The domain stays completely agnostic to marketplace specifics.

import type { MarketplaceKey, ListingStatus } from '../../../shared/types';

export interface ListingPublishInput {
  productName: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  condition: string;
  imageUrls: string[];
}

export interface PublishResult {
  externalListingId: string;
  publishedAt: Date;
}

export interface SyncedListing {
  externalListingId: string;
  status: ListingStatus;
  views: number;
  watchers: number;
  messages: number;
}

export interface IMarketplaceAdapter {
  getKey(): MarketplaceKey;

  // Publish a new listing to the marketplace.
  publish(input: ListingPublishInput): Promise<PublishResult>;

  // Update fields of an existing marketplace listing.
  updateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
  ): Promise<void>;

  // Remove/unpublish a listing.
  delist(externalListingId: string): Promise<void>;

  // Pull current stats/status for the given external listing ids.
  sync(externalListingIds: string[]): Promise<SyncedListing[]>;

  // Fetch a single listing's current state.
  fetchListing(externalListingId: string): Promise<SyncedListing | null>;
}
