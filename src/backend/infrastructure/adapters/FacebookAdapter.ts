// Facebook Marketplace adapter. Maps the domain ListingPublishInput <-> the
// Facebook Graph `/marketplace_listings` payload. HTTP boundary is injectable;
// a deterministic stub is used when none is provided.

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

const FB_GRAPH_URL = 'https://graph.facebook.com/v18.0';

interface FbListing {
  id: string;
  listing_status?: string;
  insights?: { impressions?: number; saves?: number; messages?: number };
}

export class FacebookAdapter extends BaseMarketplaceAdapter {
  constructor(http?: MarketplaceHttpClient, options?: MarketplaceAdapterOptions) {
    super(
      http ?? new StubMarketplaceHttpClient(FacebookAdapter.stubResponder),
      'facebook',
      options,
    );
  }

  protected async doPublish(input: ListingPublishInput): Promise<PublishResult> {
    const res = await this.http.request<FbListing>({
      method: 'POST',
      url: `${FB_GRAPH_URL}/me/marketplace_listings`,
      body: {
        title: input.productName,
        description: input.description,
        price: `${input.price} ${input.currency}`,
        category: input.category,
        condition: this.mapCondition(input.condition),
        photos: input.imageUrls,
      },
    });
    return { externalListingId: res.data.id, publishedAt: new Date() };
  }

  protected async doUpdateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (changes.price !== undefined) body.price = String(changes.price);
    if (changes.description !== undefined) body.description = changes.description;
    if (changes.productName !== undefined) body.title = changes.productName;
    await this.http.request({
      method: 'POST',
      url: `${FB_GRAPH_URL}/${externalListingId}`,
      body,
    });
  }

  protected async doDelist(externalListingId: string): Promise<void> {
    await this.http.request({
      method: 'DELETE',
      url: `${FB_GRAPH_URL}/${externalListingId}`,
    });
  }

  protected async doSync(externalListingIds: string[]): Promise<SyncedListing[]> {
    const responses = await Promise.all(
      externalListingIds.map((id) =>
        this.http.request<FbListing>({
          method: 'GET',
          url: `${FB_GRAPH_URL}/${id}`,
          query: { fields: 'id,listing_status,insights' },
        }),
      ),
    );
    return responses.map((res) => this.toSyncedListing(res.data));
  }

  protected async doFetchListing(
    externalListingId: string,
  ): Promise<SyncedListing | null> {
    const res = await this.http.request<FbListing | null>({
      method: 'GET',
      url: `${FB_GRAPH_URL}/${externalListingId}`,
      query: { fields: 'id,listing_status,insights' },
    });
    if (!res.data) return null;
    return this.toSyncedListing(res.data);
  }

  protected mapStatus(raw: string): ReturnType<BaseMarketplaceAdapter['mapStatus']> {
    switch (raw?.toUpperCase()) {
      case 'ACTIVE':
        return 'live';
      case 'PENDING':
        return 'draft';
      case 'SOLD':
      case 'EXPIRED':
        return 'expired';
      default:
        return super.mapStatus(raw);
    }
  }

  private mapCondition(domainCondition: string): string {
    switch (domainCondition.toLowerCase()) {
      case 'new':
        return 'NEW';
      case 'refurbished':
        return 'REFURBISHED';
      default:
        return 'USED';
    }
  }

  private toSyncedListing(data: FbListing): SyncedListing {
    return {
      externalListingId: data.id,
      status: this.mapStatus(data.listing_status ?? 'PENDING'),
      views: data.insights?.impressions ?? 0,
      watchers: data.insights?.saves ?? 0,
      messages: data.insights?.messages ?? 0,
    };
  }

  private static stubResponder: StubResponder = (config): HttpResponse => {
    const idMatch = config.url.match(/\/(\d+|[a-z]+-\d+)(?:\?|$)/);
    const externalId = idMatch ? idMatch[1] : `fb-${Date.now()}`;
    if (config.method === 'POST' && config.url.endsWith('marketplace_listings')) {
      return { status: 201, data: { id: `fb-${Date.now()}`, listing_status: 'ACTIVE' } };
    }
    if (config.method === 'POST' || config.method === 'DELETE') {
      return { status: 200, data: {} };
    }
    return {
      status: 200,
      data: {
        id: externalId,
        listing_status: 'ACTIVE',
        insights: { impressions: 0, saves: 0, messages: 0 },
      },
    };
  };
}
