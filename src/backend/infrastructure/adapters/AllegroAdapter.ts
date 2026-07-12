// Allegro marketplace adapter. Maps the domain ListingPublishInput <-> the
// Allegro `/sale/offers` payload (offer envelope with sellingMode/stock). HTTP
// boundary is injectable; a deterministic stub is used when none is provided.

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

const ALLEGRO_BASE_URL = 'https://api.allegro.pl';

interface AllegroOffer {
  id: string;
  publication?: { status?: string };
  stats?: { visitsCount?: number; watchersCount?: number; ordersCount?: number };
}

export class AllegroAdapter extends BaseMarketplaceAdapter {
  constructor(http?: MarketplaceHttpClient, options?: MarketplaceAdapterOptions) {
    super(
      http ?? new StubMarketplaceHttpClient(AllegroAdapter.stubResponder),
      'allegro',
      options,
    );
  }

  protected async doPublish(input: ListingPublishInput): Promise<PublishResult> {
    const res = await this.http.request<AllegroOffer>({
      method: 'POST',
      url: `${ALLEGRO_BASE_URL}/sale/offers`,
      headers: { Accept: 'application/vnd.allegro.public.v1+json' },
      body: {
        name: input.productName,
        description: { sections: [{ items: [{ type: 'TEXT', content: input.description }] }] },
        sellingMode: { format: 'BUY_NOW', price: { amount: String(input.price), currency: input.currency } },
        category: { id: input.category },
        images: input.imageUrls.map((url) => ({ url })),
        parameters: [{ name: 'condition', values: [input.condition] }],
      },
    });
    return { externalListingId: res.data.id, publishedAt: new Date() };
  }

  protected async doUpdateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (changes.price !== undefined) {
      body.sellingMode = { price: { amount: String(changes.price) } };
    }
    if (changes.description !== undefined) {
      body.description = { sections: [{ items: [{ type: 'TEXT', content: changes.description }] }] };
    }
    if (changes.productName !== undefined) body.name = changes.productName;
    await this.http.request({
      method: 'PATCH',
      url: `${ALLEGRO_BASE_URL}/sale/offers/${externalListingId}`,
      body,
    });
  }

  protected async doDelist(externalListingId: string): Promise<void> {
    await this.http.request({
      method: 'PUT',
      url: `${ALLEGRO_BASE_URL}/sale/offers/${externalListingId}/publication`,
      body: { publication: { status: 'ENDED' } },
    });
  }

  protected async doSync(externalListingIds: string[]): Promise<SyncedListing[]> {
    const responses = await Promise.all(
      externalListingIds.map((id) =>
        this.http.request<AllegroOffer>({
          method: 'GET',
          url: `${ALLEGRO_BASE_URL}/sale/offers/${id}`,
        }),
      ),
    );
    return responses.map((res) => this.toSyncedListing(res.data));
  }

  protected async doFetchListing(
    externalListingId: string,
  ): Promise<SyncedListing | null> {
    const res = await this.http.request<AllegroOffer | null>({
      method: 'GET',
      url: `${ALLEGRO_BASE_URL}/sale/offers/${externalListingId}`,
    });
    if (!res.data) return null;
    return this.toSyncedListing(res.data);
  }

  protected mapStatus(raw: string): ReturnType<BaseMarketplaceAdapter['mapStatus']> {
    switch (raw?.toUpperCase()) {
      case 'ACTIVE':
        return 'live';
      case 'INACTIVE':
      case 'ENDED':
        return 'expired';
      default:
        return super.mapStatus(raw);
    }
  }

  private toSyncedListing(data: AllegroOffer): SyncedListing {
    return {
      externalListingId: data.id,
      status: this.mapStatus(data.publication?.status ?? 'INACTIVE'),
      views: data.stats?.visitsCount ?? 0,
      watchers: data.stats?.watchersCount ?? 0,
      messages: data.stats?.ordersCount ?? 0,
    };
  }

  private static stubResponder: StubResponder = (config): HttpResponse => {
    const idMatch = config.url.match(/\/sale\/offers\/([^/?]+)/);
    const externalId = idMatch ? idMatch[1] : `allegro-${Date.now()}`;
    if (config.method === 'POST') {
      return {
        status: 201,
        data: { id: `allegro-${Date.now()}`, publication: { status: 'ACTIVE' } },
      };
    }
    if (config.method === 'PATCH' || config.method === 'PUT' || config.method === 'DELETE') {
      return { status: 200, data: {} };
    }
    return {
      status: 200,
      data: {
        id: externalId,
        publication: { status: 'ACTIVE' },
        stats: { visitsCount: 0, watchersCount: 0, ordersCount: 0 },
      },
    };
  };
}
