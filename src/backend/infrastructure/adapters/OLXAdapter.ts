// OLX Partner API adapter. Maps domain listing data to the documented
// `POST /api/partner/adverts` contract. The HTTP boundary stays injectable so
// OAuth credentials are resolved per marketplace account by the publish worker.

import { BaseMarketplaceAdapter, type MarketplaceAdapterOptions } from './BaseMarketplaceAdapter';
import {
  type MarketplaceHttpClient,
  StubMarketplaceHttpClient,
  HttpError,
  type HttpRequestConfig,
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
import { evaluateOlxCategory } from '../../domain/services/OlxCategoryGuard';
import { OlxTaxonomyResolver, type OlxTrustedTaxonomyResolver } from './OlxTaxonomyResolver';

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
  title?: string;
  description?: string | null;
  category?: { id?: string | number; name?: string; path?: string[] | string; leaf?: boolean } | string | null;
  url?: string | null;
  public_url?: string | null;
  external_url?: string | null;
  price?: { value?: number | string; currency?: string } | number | string | null;
  photos?: Array<{ url?: string | null }>;
  images?: Array<{ url?: string | null }>;
  updated_at?: string | null;
  metrics?: { views?: unknown; favorites?: unknown; favourites?: unknown; watchers?: unknown; messages?: unknown };
  statistics?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  counters?: Record<string, unknown>;
}

interface OlxAdvertListResponse {
  data: OlxAdvertResponse[];
  links?: { next?: string | null };
  meta?: { last_page?: number };
}

interface OlxAdvertStatisticsResponse extends Record<string, unknown> {
  advert_views?: unknown;
  phone_views?: unknown;
  users_observing?: unknown;
}

type OlxAdvertStatisticsResult =
  | { status: 'success'; data: OlxAdvertStatisticsResponse }
  | { status: 'unavailable'; data: null }
  | { status: 'error'; data: null };

interface OlxResponseEnvelope<T> {
  data: T;
}

export class OLXAdapter extends BaseMarketplaceAdapter {
  private readonly baseUrl: string;

  constructor(
    http?: MarketplaceHttpClient,
    options?: MarketplaceAdapterOptions,
    private readonly config: OlxAdapterConfig = {},
    private readonly taxonomy: OlxTrustedTaxonomyResolver = new OlxTaxonomyResolver(
      http ?? new StubMarketplaceHttpClient(OLXAdapter.stubResponder),
      config.baseUrl ?? OLX_PARTNER_BASE_URL,
    ),
  ) {
    super(http ?? new StubMarketplaceHttpClient(OLXAdapter.stubResponder), 'olx', options);
    this.baseUrl = (config.baseUrl ?? OLX_PARTNER_BASE_URL).replace(/\/$/, '');
  }

  protected async doPublish(input: ListingPublishInput): Promise<PublishResult> {
    const categoryId = this.resolvePublishCategory(input);
    this.assertPublishDetails(categoryId);
    return this.sendPreparedAdvert(this.createAdvertRequest(this.buildAdvertPayload(input, categoryId)));
  }

  async preparePublish(input: ListingPublishInput): Promise<{ execute(): Promise<PublishResult> }> {
    const categoryId = this.resolvePublishCategory(input);
    this.assertPublishDetails(categoryId);
    const body = this.buildAdvertPayload(input, categoryId);
    const request = this.createAdvertRequest(body);
    this.http.assertRequestAllowed?.(request);
    return {
      execute: () => this.execute('publish', () => this.sendPreparedAdvert(request), { retry: false }),
    };
  }

  private createAdvertRequest(body: Record<string, unknown>): HttpRequestConfig {
    return {
      method: 'POST',
      url: `${this.baseUrl}/adverts`,
      body,
    };
  }

  private async sendPreparedAdvert(request: HttpRequestConfig): Promise<PublishResult> {
    const res = await this.http.request<
      OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>
    >(request);
    const advert = this.unwrapAdvert(res.data);
    return {
      externalListingId: String(advert.id),
      externalUrl: this.extractPublicUrl(advert),
      publishedAt: new Date(),
      remoteStatus: advert.status ?? null,
      remoteImageUrls: this.extractImageUrls(advert),
    };
  }

  protected async doUpdateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
    current: ListingPublishInput,
  ): Promise<void> {
    const updated = { ...current, ...changes };
    const categoryId = this.resolvePublishCategory(updated);
    this.assertPublishDetails(categoryId);
    const body = this.buildAdvertPayload(updated, categoryId);
    await this.http.request({
      method: 'PUT',
      url: `${this.baseUrl}/adverts/${externalListingId}`,
      body,
    });
  }

  private buildAdvertPayload(
    input: ListingPublishInput,
    categoryId: number,
  ): Record<string, unknown> {
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
    return body;
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
          const [res, statistics] = await Promise.all([
            this.http.request<OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>>({
              method: 'GET',
              url: `${this.baseUrl}/adverts/${id}`,
            }),
            this.fetchAdvertStatistics(id),
          ]);
          const advert = this.unwrapAdvert(res.data);
          return this.toSyncedListing(
            this.withStatistics(advert, statistics.data),
            statistics.status,
          );
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
      const [res, statistics] = await Promise.all([
        this.http.request<OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse> | null>({
          method: 'GET',
          url: `${this.baseUrl}/adverts/${externalListingId}`,
        }),
        this.fetchAdvertStatistics(externalListingId),
      ]);
      if (!res.data) return null;
      const advert = this.unwrapAdvert(res.data);
      return this.toSyncedListing(
        this.withStatistics(advert, statistics.data),
        statistics.status,
      );
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
      messages: null,
      messageMetricStatus: 'unavailable',
    };
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
      imported.push(
        ...(await this.mapWithConcurrency(res.data.data, 5, async (advert) => {
          const statistics = await this.fetchAdvertStatistics(String(advert.id));
          return this.toImportedListing(this.withStatistics(advert, statistics.data));
        }))
      );
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

  private async fetchAdvertStatistics(
    externalListingId: string,
  ): Promise<OlxAdvertStatisticsResult> {
    try {
      const res = await this.http.request<
        OlxAdvertStatisticsResponse | OlxResponseEnvelope<OlxAdvertStatisticsResponse> | null
      >({
        method: 'GET',
        url: `${this.baseUrl}/adverts/${externalListingId}/statistics`,
      });
      if (!res.data) return { status: 'unavailable', data: null };
      return {
        status: 'success',
        data: ('data' in res.data ? res.data.data : res.data) as OlxAdvertStatisticsResponse,
      };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return { status: 'unavailable', data: null };
      }
      return { status: 'error', data: null };
    }
  }

  private withStatistics(
    advert: OlxAdvertResponse,
    statistics: OlxAdvertStatisticsResponse | null,
  ): OlxAdvertResponse {
    return statistics
      ? { ...advert, statistics: { ...advert.statistics, ...statistics } }
      : advert;
  }

  private async toSyncedListing(
    data: OlxAdvertResponse,
    statisticsStatus: OlxAdvertStatisticsResult['status'],
  ): Promise<SyncedListing> {
    const remoteStatus = String(data.status ?? 'unknown').toLowerCase();
    const messages = this.extractMessages(data);
    return {
      externalListingId: String(data.id),
      externalUrl: this.extractPublicUrl(data),
      status: OLX_STATUS_TO_LOCAL[remoteStatus] ?? 'draft',
      remoteStatus,
      views: this.extractViews(data),
      watchers: this.extractWatchers(data),
      messages: messages ?? (statisticsStatus === 'error' ? undefined : null),
      messageMetricStatus:
        messages !== null ? 'available' : statisticsStatus === 'error' ? 'error' : 'unavailable',
      marketplaceCategory: await this.extractMarketplaceCategory(data),
    };
  }

  private async toImportedListing(data: OlxAdvertResponse): Promise<ImportedMarketplaceListing> {
    const price = this.extractPrice(data.price);
    const views = this.extractViews(data);
    const watchers = this.extractWatchers(data);
    const messages = this.extractMessages(data);
    return {
      externalListingId: String(data.id),
      externalUrl: this.extractPublicUrl(data),
      title: data.title?.trim() || `OLX advert ${data.id}`,
      description: data.description ?? null,
      price: price.value,
      currency: price.currency,
      status: OLX_STATUS_TO_LOCAL[String(data.status ?? 'unknown').toLowerCase()] ?? 'draft',
      remoteStatus: data.status,
      category: typeof data.category === 'string' ? data.category : data.category?.name ?? null,
      marketplaceCategory: await this.extractMarketplaceCategory(data),
      imageUrls: this.extractImageUrls(data),
      remoteUpdatedAt: data.updated_at ? new Date(data.updated_at) : null,
      metrics: {
        views: views ?? undefined,
        watchers: watchers ?? undefined,
        messages: messages ?? undefined,
      },
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

  private extractImageUrls(data: OlxAdvertResponse): string[] {
    return [...(data.photos ?? []), ...(data.images ?? [])].flatMap((image) =>
      image.url ? [image.url] : []
    );
  }

  private extractCounter(data: OlxAdvertResponse, keys: string[]): number | null {
    for (const source of [data.statistics, data.metrics, data.stats, data.counters, data]) {
      if (!source) continue;
      for (const key of keys) {
        const value = (source as Record<string, unknown>)[key];
        const parsed = this.parseCounter(value);
        if (parsed !== null) return parsed;
      }
    }
    return null;
  }

  private extractViews(data: OlxAdvertResponse): number | null {
    return this.extractCounter(data, ['views', 'view_count', 'views_count', 'advert_views', 'page_views']);
  }

  private extractWatchers(data: OlxAdvertResponse): number | null {
    return this.extractCounter(data, [
      'favorites',
      'favourites',
      'watchers',
      'favorite_count',
      'favourite_count',
      'favorites_count',
      'favourites_count',
      'observed_count',
      'users_observing',
    ]);
  }

  private extractMessages(data: OlxAdvertResponse): number | null {
    return this.extractCounter(data, [
      'messages',
      'message_count',
      'messages_count',
    ]);
  }

  private parseCounter(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isInteger(value) && value >= 0 ? value : null;
    }
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }


  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = [];
    for (let index = 0; index < items.length; index += limit) {
      const batch = items.slice(index, index + limit);
      results.push(...(await Promise.all(batch.map(mapper))));
    }
    return results;
  }

  private assertPublishDetails(categoryId: number | undefined): asserts categoryId is number {
    if (!this.config.requirePublishDetails) return;
    if (!categoryId) throw new Error('OLX category id is required for live publish');
    if (!this.config.cityId) throw new Error('OLX city id is required for live publish');
    if (!this.config.contactName?.trim()) {
      throw new Error('OLX contact name is required for live publish');
    }
  }

  private resolvePublishCategory(input: ListingPublishInput): number | undefined {
    if (this.config.requirePublishDetails) {
      const decision = evaluateOlxCategory({
        name: input.productName, description: input.description, category: input.category,
      }, input.marketplaceCategory ?? null);
      if (!decision.allowed) throw new Error(decision.message ?? 'OLX category validation failed');
      const exact = input.marketplaceCategory!;
      const id = Number(exact.providerCategoryId);
      return Number.isSafeInteger(id) && id > 0 ? id : undefined;
    }
    return input.marketplaceCategory
      ? Number(input.marketplaceCategory.providerCategoryId)
      : this.mapCategory(input.category);
  }

  private async extractMarketplaceCategory(data: OlxAdvertResponse) {
    if (!data.category || typeof data.category === 'string' || data.category.id === undefined) return null;
    try {
      return await this.taxonomy.verify(String(data.category.id));
    } catch {
      // Advert payloads do not attest taxonomy path, leafness, confidence, or freshness.
      // Resolver failure is transient/unknown: preserve previously verified sync metadata.
      // Null remains reserved for provider-declared absence or invalid category data.
      return undefined;
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
