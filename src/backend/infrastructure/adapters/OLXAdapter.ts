// OLX Partner API adapter. Maps domain listing data to the documented
// `POST /api/partner/adverts` contract. The HTTP boundary stays injectable so
// OAuth credentials are resolved per marketplace account by the publish worker.

import { BaseMarketplaceAdapter, type MarketplaceAdapterOptions } from './BaseMarketplaceAdapter';
import {
  type MarketplaceHttpClient,
  StubMarketplaceHttpClient,
  type StubResponder,
  type HttpResponse,
} from './MarketplaceHttpClient';
import type {
  ImportDiscoveryOptions,
  ImportedMarketplaceListing,
  ListingPublishInput,
  PublishResult,
  SyncedListing,
} from '../../domain/services/MarketplaceAdapter';

const OLX_PARTNER_BASE_URL = 'https://www.olx.pl/api/partner';

// Stub/demo fallback only. Real mode sets requirePublishDetails=true and must
// provide an approved category id instead of relying on these placeholders.
const STUB_CATEGORY_MAP: Record<string, number> = {
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

export interface OlxAdapterConfig {
  baseUrl?: string;
  requirePublishDetails?: boolean;
  categoryIds?: Record<string, number>;
  defaultCategoryId?: number;
  cityId?: number;
  districtId?: number;
  contactName?: string;
  contactPhone?: string;
  advertiserType?: 'private' | 'business';
  priceNegotiable?: boolean;
  conditionAttributeCode?: string;
  deliveryAttributeCode?: string;
  deliveryOptionCode?: string;
}

interface OlxAdvertResponse {
  id: string | number;
  status: string;
  title?: string;
  description?: string | null;
  category?: { id?: string | number; name?: string } | string | null;
  url?: string | null;
  public_url?: string | null;
  external_url?: string | null;
  price?: { value?: number | string; currency?: string } | number | string | null;
  photos?: Array<{ url?: string | null }>;
  updated_at?: string | null;
  metrics?: { views?: number; favorites?: number; messages?: number };
}

interface OlxAdvertListResponse {
  data: OlxAdvertResponse[];
  links?: { next?: string | null };
  meta?: { last_page?: number };
}

interface OlxResponseEnvelope<T> {
  data: T;
}

export class OLXAdapter extends BaseMarketplaceAdapter {
  private readonly baseUrl: string;

  constructor(
    http?: MarketplaceHttpClient,
    options?: MarketplaceAdapterOptions,
    private readonly config: OlxAdapterConfig = {},
  ) {
    super(http ?? new StubMarketplaceHttpClient(OLXAdapter.stubResponder), 'olx', options);
    this.baseUrl = (config.baseUrl ?? OLX_PARTNER_BASE_URL).replace(/\/$/, '');
  }

  protected async doPublish(input: ListingPublishInput): Promise<PublishResult> {
    const categoryId = this.mapCategory(input.category);
    this.assertPublishDetails(categoryId);

    const body: Record<string, unknown> = {
      title: input.productName,
      description: input.description,
      category_id: categoryId,
      advertiser_type: this.config.advertiserType ?? 'private',
      price: {
        value: input.price,
        currency: input.currency,
        negotiable: this.config.priceNegotiable ?? false,
      },
      images: input.imageUrls.map((url) => ({ url })),
    };
    if (this.config.cityId) {
      body.location = {
        city_id: this.config.cityId,
        ...(this.config.districtId ? { district_id: this.config.districtId } : {}),
      };
    }
    if (this.config.contactName) {
      body.contact = {
        name: this.config.contactName,
        ...(this.config.contactPhone ? { phone: this.config.contactPhone } : {}),
      };
    }
    const attributes: Array<{ code: string; value: string }> = [];
    if (this.config.conditionAttributeCode) {
      attributes.push({
        code: this.config.conditionAttributeCode,
        value: this.mapCondition(input.condition),
      });
    }
    if (this.config.deliveryAttributeCode && this.config.deliveryOptionCode) {
      attributes.push({
        code: this.config.deliveryAttributeCode,
        value: this.config.deliveryOptionCode,
      });
    }
    if (attributes.length > 0) body.attributes = attributes;

    const res = await this.http.request<
      OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>
    >({
      method: 'POST',
      url: `${this.baseUrl}/adverts`,
      body,
    });
    const advert = this.unwrapAdvert(res.data);
    return {
      externalListingId: String(advert.id),
      publishedAt: new Date(),
    };
  }

  protected async doUpdateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (changes.price !== undefined) {
      body.price = {
        value: changes.price,
        currency: 'PLN',
        negotiable: this.config.priceNegotiable ?? false,
      };
    }
    if (changes.description !== undefined) body.description = changes.description;
    if (changes.productName !== undefined) body.title = changes.productName;
    await this.http.request({
      method: 'PUT',
      url: `${this.baseUrl}/adverts/${externalListingId}`,
      body,
    });
  }

  protected async doDelist(externalListingId: string): Promise<void> {
    await this.http.request({
      method: 'DELETE',
      url: `${this.baseUrl}/adverts/${externalListingId}`,
    });
  }

  protected async doSync(externalListingIds: string[]): Promise<SyncedListing[]> {
    const responses = await Promise.all(
      externalListingIds.map((id) =>
        this.http.request<OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>>({
          method: 'GET',
          url: `${this.baseUrl}/adverts/${id}`,
        }),
      ),
    );
    return responses.map((res) => this.toSyncedListing(this.unwrapAdvert(res.data)));
  }

  protected async doFetchListing(
    externalListingId: string,
  ): Promise<SyncedListing | null> {
    const res = await this.http.request<
      OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse> | null
    >({
      method: 'GET',
      url: `${this.baseUrl}/adverts/${externalListingId}`,
    });
    if (!res.data) return null;
    return this.toSyncedListing(this.unwrapAdvert(res.data));
  }

  protected async doListOwnedListings(
    options: ImportDiscoveryOptions = {},
  ): Promise<ImportedMarketplaceListing[]> {
    const imported: ImportedMarketplaceListing[] = [];
    const pageSize = options.pageSize ?? 100;
    const status = options.statuses?.join(',');
    let page = 1;
    for (;;) {
      const res = await this.http.request<OlxAdvertListResponse>({
        method: 'GET',
        url: `${this.baseUrl}/adverts`,
        query: { page, limit: pageSize, status },
      });
      imported.push(...res.data.data.map((advert) => this.toImportedListing(advert)));
      const lastPage = res.data.meta?.last_page;
      if (lastPage !== undefined ? page >= lastPage : !res.data.links?.next) break;
      page += 1;
    }
    return imported;
  }

  private unwrapAdvert(
    response: OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>,
  ): OlxAdvertResponse {
    return 'data' in response ? response.data : response;
  }

  private toSyncedListing(data: OlxAdvertResponse): SyncedListing {
    return {
      externalListingId: String(data.id),
      status: this.mapStatus(data.status),
      views: data.metrics?.views ?? 0,
      watchers: data.metrics?.favorites ?? 0,
      messages: data.metrics?.messages ?? 0,
    };
  }

  private toImportedListing(data: OlxAdvertResponse): ImportedMarketplaceListing {
    const price = this.extractPrice(data.price);
    return {
      externalListingId: String(data.id),
      externalUrl: this.extractPublicUrl(data),
      title: data.title?.trim() || `OLX advert ${data.id}`,
      description: data.description ?? null,
      price: price.value,
      currency: price.currency,
      status: this.mapStatus(data.status),
      remoteStatus: data.status,
      category: typeof data.category === 'string' ? data.category : data.category?.name ?? null,
      imageUrls: (data.photos ?? []).flatMap((photo) => (photo.url ? [photo.url] : [])),
      remoteUpdatedAt: data.updated_at ? new Date(data.updated_at) : null,
      metrics: {
        views: data.metrics?.views,
        watchers: data.metrics?.favorites,
        messages: data.metrics?.messages,
      },
    };
  }

  private extractPublicUrl(data: OlxAdvertResponse): string | null {
    const candidate = data.url ?? data.public_url ?? data.external_url;
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:') return null;
      if (!/(^|\.)olx\.pl$/i.test(parsed.hostname)) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  private extractPrice(price: OlxAdvertResponse['price']): { value: number | null; currency: string | null } {
    if (typeof price === 'number') return { value: price, currency: null };
    if (typeof price === 'string') {
      const parsed = price.trim() === '' ? Number.NaN : Number(price);
      return { value: Number.isFinite(parsed) ? parsed : null, currency: null };
    }
    if (!price) return { value: null, currency: null };
    const parsed =
      typeof price.value === 'string'
        ? price.value.trim() === ''
          ? Number.NaN
          : Number(price.value)
        : price.value;
    return {
      value: Number.isFinite(parsed) ? parsed ?? null : null,
      currency: price.currency ?? null,
    };
  }

  private assertPublishDetails(categoryId: number | undefined): asserts categoryId is number {
    if (!this.config.requirePublishDetails) return;
    if (!categoryId) throw new Error('OLX category id is required for live publish');
    if (!this.config.cityId) throw new Error('OLX city id is required for live publish');
    if (!this.config.contactName?.trim()) {
      throw new Error('OLX contact name is required for live publish');
    }
  }

  private mapCategory(domainCategory: string): number | undefined {
    const key = domainCategory.toLowerCase();
    return (
      this.config.categoryIds?.[key] ??
      this.config.defaultCategoryId ??
      (this.config.requirePublishDetails ? undefined : STUB_CATEGORY_MAP[key] ?? STUB_CATEGORY_MAP.electronics)
    );
  }

  private mapCondition(domainCondition: string): string {
    return OLX_CONDITION_MAP[domainCondition.toLowerCase()] ?? 'used';
  }

  private static stubResponder: StubResponder = (config): HttpResponse => {
    const idMatch = config.url.match(/\/adverts\/([^/?]+)/);
    const externalId = idMatch ? idMatch[1] : `olx-${Date.now()}`;
    if (config.method === 'POST') {
      return { status: 201, data: { id: `olx-${Date.now()}`, status: 'active' } };
    }
    if (config.method === 'PUT' || config.method === 'DELETE') {
      return { status: 204, data: {} };
    }
    if (config.method === 'GET' && config.url.endsWith('/adverts')) {
      return {
        status: 200,
        data: {
          data: [
            {
              id: 'olx-demo',
              status: 'active',
              title: 'Demo OLX advert',
              metrics: { views: 0, favorites: 0, messages: 0 },
            },
          ],
          meta: { last_page: 1 },
        },
      };
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
