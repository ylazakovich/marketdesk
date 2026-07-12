// OLX marketplace adapter. Modeled on ARCHITECTURE.md §9 (OLX example). Maps the
// domain ListingPublishInput <-> the OLX `/user/ads` payload shape. The HTTP
// boundary is injectable; when none is provided a deterministic stub is used so
// the adapter is exercisable without touching the real OLX API.

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

const OLX_BASE_URL = 'https://api.olx.pl/v1';

// OLX category ids (subset — a real integration would load the full taxonomy).
const OLX_CATEGORY_MAP: Record<string, number> = {
  electronics: 2000,
  clothing: 3000,
  home: 4000,
  toys: 5000,
  sports: 6000,
};

const OLX_CONDITION_MAP: Record<string, string> = {
  new: 'new',
  like_new: 'used',
  good: 'used',
  fair: 'used',
  poor: 'used',
  refurbished: 'used',
};

interface OlxAdResponse {
  id: string;
  status: string;
  metrics?: { views?: number; favorites?: number; messages?: number };
}

export class OLXAdapter extends BaseMarketplaceAdapter {
  constructor(http?: MarketplaceHttpClient, options?: MarketplaceAdapterOptions) {
    super(http ?? new StubMarketplaceHttpClient(OLXAdapter.stubResponder), 'olx', options);
  }

  protected async doPublish(input: ListingPublishInput): Promise<PublishResult> {
    const res = await this.http.request<OlxAdResponse>({
      method: 'POST',
      url: `${OLX_BASE_URL}/user/ads`,
      body: {
        title: input.productName,
        description: input.description,
        price: input.price,
        currency: input.currency,
        category_id: this.mapCategory(input.category),
        images: input.imageUrls,
        params: { condition: this.mapCondition(input.condition) },
      },
    });
    return {
      externalListingId: res.data.id,
      publishedAt: new Date(),
    };
  }

  protected async doUpdateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (changes.price !== undefined) body.price = changes.price;
    if (changes.description !== undefined) body.description = changes.description;
    if (changes.productName !== undefined) body.title = changes.productName;
    await this.http.request({
      method: 'PUT',
      url: `${OLX_BASE_URL}/user/ads/${externalListingId}`,
      body,
    });
  }

  protected async doDelist(externalListingId: string): Promise<void> {
    await this.http.request({
      method: 'DELETE',
      url: `${OLX_BASE_URL}/user/ads/${externalListingId}`,
    });
  }

  protected async doSync(externalListingIds: string[]): Promise<SyncedListing[]> {
    const responses = await Promise.all(
      externalListingIds.map((id) =>
        this.http.request<OlxAdResponse>({
          method: 'GET',
          url: `${OLX_BASE_URL}/user/ads/${id}`,
        }),
      ),
    );
    return responses.map((res) => this.toSyncedListing(res.data));
  }

  protected async doFetchListing(
    externalListingId: string,
  ): Promise<SyncedListing | null> {
    const res = await this.http.request<OlxAdResponse | null>({
      method: 'GET',
      url: `${OLX_BASE_URL}/user/ads/${externalListingId}`,
    });
    if (!res.data) return null;
    return this.toSyncedListing(res.data);
  }

  private toSyncedListing(data: OlxAdResponse): SyncedListing {
    return {
      externalListingId: data.id,
      status: this.mapStatus(data.status),
      views: data.metrics?.views ?? 0,
      watchers: data.metrics?.favorites ?? 0,
      messages: data.metrics?.messages ?? 0,
    };
  }

  private mapCategory(domainCategory: string): number {
    return OLX_CATEGORY_MAP[domainCategory.toLowerCase()] ?? OLX_CATEGORY_MAP.electronics;
  }

  private mapCondition(domainCondition: string): string {
    return OLX_CONDITION_MAP[domainCondition.toLowerCase()] ?? 'used';
  }

  // Deterministic stub transport for no-network / demo operation.
  private static stubResponder: StubResponder = (config): HttpResponse => {
    const idMatch = config.url.match(/\/user\/ads\/([^/?]+)/);
    const externalId = idMatch ? idMatch[1] : `olx-${Date.now()}`;
    if (config.method === 'POST') {
      return { status: 201, data: { id: `olx-${Date.now()}`, status: 'active' } };
    }
    if (config.method === 'PUT' || config.method === 'DELETE') {
      return { status: 204, data: {} };
    }
    return {
      status: 200,
      data: {
        id: externalId,
        status: 'active',
        metrics: { views: 0, favorites: 0, messages: 0 },
      },
    };
  };
}
