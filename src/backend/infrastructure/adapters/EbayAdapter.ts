// eBay marketplace adapter — intentionally a stub. Per ARCHITECTURE.md §9, eBay
// is registered in the factory but not yet implemented. Every operation throws
// a clearly-marked MarketplaceNotImplementedError so callers fail loudly rather
// than silently no-op. getKey() still works so the factory/registry behave.

import { BaseMarketplaceAdapter, MarketplaceAdapterOptions } from './BaseMarketplaceAdapter';
import {
  MarketplaceHttpClient,
  StubMarketplaceHttpClient,
} from './MarketplaceHttpClient';
import { MarketplaceNotImplementedError } from './MarketplaceError';
import type {
  ListingPublishInput,
  PublishResult,
  SyncedListing,
} from '../../domain/services/MarketplaceAdapter';

export class EbayAdapter extends BaseMarketplaceAdapter {
  constructor(http?: MarketplaceHttpClient, options?: MarketplaceAdapterOptions) {
    // No real transport is used; a throwing stub documents that intent.
    super(
      http ??
        new StubMarketplaceHttpClient(() => {
          throw new MarketplaceNotImplementedError('ebay: adapter not implemented');
        }),
      'ebay',
      options,
    );
  }

  private notImplemented(op: string): never {
    throw new MarketplaceNotImplementedError(`ebay: ${op} is not implemented yet`);
  }

  protected doPublish(_input: ListingPublishInput): Promise<PublishResult> {
    return this.notImplemented('publish');
  }

  protected doUpdateListing(
    _externalListingId: string,
    _changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
  ): Promise<void> {
    return this.notImplemented('updateListing');
  }

  protected doDelist(_externalListingId: string): Promise<void> {
    return this.notImplemented('delist');
  }

  protected doSync(_externalListingIds: string[]): Promise<SyncedListing[]> {
    return this.notImplemented('sync');
  }

  protected doFetchListing(_externalListingId: string): Promise<SyncedListing | null> {
    return this.notImplemented('fetchListing');
  }
}
