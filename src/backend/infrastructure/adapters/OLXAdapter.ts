// OLX Partner API adapter. Maps domain listing data to the documented
// `POST /api/partner/adverts` contract. The HTTP boundary stays injectable so
// OAuth credentials are resolved per marketplace account by the publish worker.

import { BaseMarketplaceAdapter, type MarketplaceAdapterOptions } from './BaseMarketplaceAdapter';
import {
  type MarketplaceHttpClient,
  StubMarketplaceHttpClient,
  HttpError,
  type StubResponder,
  type HttpResponse,
} from './MarketplaceHttpClient';
import type {
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

// Observed/supported OLX Partner advert lifecycle vocabulary. Transient states
// remain non-destructive; unknown values are surfaced to the sync handler via
// remoteStatus and must not force local state changes.
const OLX_STATUS_TO_LOCAL: Record<string, SyncedListing['status']> = {
  active: 'live',
  activated: 'live',
  live: 'live',
  published: 'live',
  new: 'live',
  moderation: 'live',
  pending: 'live',
  limited: 'live',
  expired: 'expired',
  removed: 'expired',
  deactivated: 'expired',
  deleted: 'expired',
  closed: 'expired',
  rejected: 'error',
  blocked: 'error',
  error: 'error',
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
  url?: string | null;
  public_url?: string | null;
  external_url?: string | null;
  metrics?: { views?: unknown; favorites?: unknown; messages?: unknown };
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
      externalUrl: this.extractPublicUrl(advert),
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
      externalListingIds.map(async (id) => {
        try {
          const res = await this.http.request<
            OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>
          >({
            method: 'GET',
            url: `${this.baseUrl}/adverts/${id}`,
          });
          return this.toSyncedListing(this.unwrapAdvert(res.data));
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) {
            return this.missingSyncedListing(id);
          }
          throw error;
        }
      }),
    );
    return responses;
  }

  protected async doFetchListing(
    externalListingId: string,
  ): Promise<SyncedListing | null> {
    try {
      const res = await this.http.request<
        OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse> | null
      >({
        method: 'GET',
        url: `${this.baseUrl}/adverts/${externalListingId}`,
      });
      if (!res.data) return null;
      return this.toSyncedListing(this.unwrapAdvert(res.data));
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  private missingSyncedListing(externalListingId: string): SyncedListing {
    return {
      externalListingId,
      status: 'expired',
      remoteStatus: 'missing',
      missing: true,
      views: 0,
      watchers: 0,
      messages: 0,
    };
  }

  private unwrapAdvert(
    response: OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>,
  ): OlxAdvertResponse {
    return 'data' in response ? response.data : response;
  }

  private toSyncedListing(data: OlxAdvertResponse): SyncedListing {
    const remoteStatus = String(data.status ?? 'unknown').toLowerCase();
    return {
      externalListingId: String(data.id),
      externalUrl: this.extractPublicUrl(data),
      status: OLX_STATUS_TO_LOCAL[remoteStatus] ?? 'draft',
      remoteStatus,
      views: this.parseCounter(data.metrics?.views),
      watchers: this.parseCounter(data.metrics?.favorites),
      messages: this.parseCounter(data.metrics?.messages),
    };
  }

  private extractPublicUrl(data: OlxAdvertResponse): string | null {
    for (const candidate of [data.url, data.public_url, data.external_url]) {
      if (!candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:') continue;
        if (!/(^|\.)olx\.pl$/i.test(parsed.hostname)) continue;
        return parsed.toString();
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  private parseCounter(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.trunc(parsed);
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
