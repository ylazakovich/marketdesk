// Vinted marketplace adapter. Maps the domain ListingPublishInput <-> the
// Vinted `/items` payload. HTTP boundary is injectable; a deterministic stub is
// used when none is provided.

import { BaseMarketplaceAdapter, MarketplaceAdapterOptions } from './BaseMarketplaceAdapter';
import {
  MarketplaceHttpClient,
  StubMarketplaceHttpClient,
  StubResponder,
  HttpResponse,
} from './MarketplaceHttpClient';
import type {
  ListingPublishInput,
  PublishResult,
  SyncedListing,
} from '../../domain/services/MarketplaceAdapter';

const VINTED_BASE_URL = 'https://www.vinted.com/api/v2';

// Vinted status ids per its item API.
const VINTED_STATUS_MAP: Record<number, string> = {
  1: 'active',
  2: 'draft',
  3: 'expired',
  4: 'error',
};

interface VintedItem {
  id: string;
  status_id?: number;
  view_count?: number;
  favourite_count?: number;
  message_count?: number;
}

export class VintedAdapter extends BaseMarketplaceAdapter {
  constructor(http?: MarketplaceHttpClient, options?: MarketplaceAdapterOptions) {
    super(
      http ?? new StubMarketplaceHttpClient(VintedAdapter.stubResponder),
      'vinted',
      options,
    );
  }

  protected async doPublish(input: ListingPublishInput): Promise<PublishResult> {
    const res = await this.http.request<{ item: VintedItem }>({
      method: 'POST',
      url: `${VINTED_BASE_URL}/items`,
      body: {
        item: {
          title: input.productName,
          description: input.description,
          price: input.price,
          currency: input.currency,
          catalog_id: input.category,
          status: input.condition,
          photo_urls: input.imageUrls,
        },
      },
    });
    return { externalListingId: res.data.item.id, publishedAt: new Date() };
  }

  protected async doUpdateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
  ): Promise<void> {
    const item: Record<string, unknown> = {};
    if (changes.price !== undefined) item.price = changes.price;
    if (changes.description !== undefined) item.description = changes.description;
    if (changes.productName !== undefined) item.title = changes.productName;
    await this.http.request({
      method: 'PUT',
      url: `${VINTED_BASE_URL}/items/${externalListingId}`,
      body: { item },
    });
  }

  protected async doDelist(externalListingId: string): Promise<void> {
    await this.http.request({
      method: 'DELETE',
      url: `${VINTED_BASE_URL}/items/${externalListingId}`,
    });
  }

  protected async doSync(externalListingIds: string[]): Promise<SyncedListing[]> {
    const responses = await Promise.all(
      externalListingIds.map((id) =>
        this.http.request<{ item: VintedItem }>({
          method: 'GET',
          url: `${VINTED_BASE_URL}/items/${id}`,
        }),
      ),
    );
    return responses.map((res) => this.toSyncedListing(res.data.item));
  }

  protected async doFetchListing(
    externalListingId: string,
  ): Promise<SyncedListing | null> {
    const res = await this.http.request<{ item: VintedItem } | null>({
      method: 'GET',
      url: `${VINTED_BASE_URL}/items/${externalListingId}`,
    });
    if (!res.data || !res.data.item) return null;
    return this.toSyncedListing(res.data.item);
  }

  private toSyncedListing(item: VintedItem): SyncedListing {
    const statusName = VINTED_STATUS_MAP[item.status_id ?? 2] ?? 'draft';
    return {
      externalListingId: item.id,
      status: this.mapStatus(statusName),
      views: item.view_count ?? 0,
      watchers: item.favourite_count ?? 0,
      messages: item.message_count ?? 0,
    };
  }

  private static stubResponder: StubResponder = (config): HttpResponse => {
    const idMatch = config.url.match(/\/items\/([^/?]+)/);
    const externalId = idMatch ? idMatch[1] : `vinted-${Date.now()}`;
    if (config.method === 'POST') {
      return { status: 201, data: { item: { id: `vinted-${Date.now()}`, status_id: 1 } } };
    }
    if (config.method === 'PUT' || config.method === 'DELETE') {
      return { status: 200, data: {} };
    }
    return {
      status: 200,
      data: {
        item: {
          id: externalId,
          status_id: 1,
          view_count: 0,
          favourite_count: 0,
          message_count: 0,
        },
      },
    };
  };
}
