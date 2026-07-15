import { OLXAdapter, type OlxAdapterConfig } from '../OLXAdapter';
import {
  MarketplaceHttpClient,
  HttpRequestConfig,
  HttpResponse,
  HttpError,
} from '../MarketplaceHttpClient';
import {
  MarketplaceAuthenticationError,
  MarketplaceRateLimitError,
  MarketplaceTransientError,
} from '../MarketplaceError';
import type { ListingPublishInput } from '../../../domain/services/MarketplaceAdapter';

const publishInput: ListingPublishInput = {
  productName: 'Vintage Camera',
  description: 'A well-kept vintage film camera in great condition.',
  price: 349.99,
  currency: 'PLN',
  category: 'electronics',
  condition: 'good',
  imageUrls: ['https://img/1.jpg', 'https://img/2.jpg'],
};

function mockClient(
  handler: (config: HttpRequestConfig) => HttpResponse | Promise<HttpResponse>,
): MarketplaceHttpClient {
  return { request: jest.fn(handler) as MarketplaceHttpClient['request'] };
}

const fastOptions = { sleep: async () => {}, maxRetries: 2, baseRetryDelayMs: 0 };
const realConfig: OlxAdapterConfig = {
  baseUrl: 'https://www.olx.pl/api/partner',
  requirePublishDetails: true,
  categoryIds: { electronics: 99 },
  cityId: 123,
  districtId: 456,
  contactName: 'Seller',
  contactPhone: '000000000',
  advertiserType: 'private',
  priceNegotiable: true,
  conditionAttributeCode: 'state',
  deliveryAttributeCode: 'delivery',
  deliveryOptionCode: 'inpost-s',
};

describe('OLXAdapter', () => {
  it('maps domain input to the OLX ad payload and returns the external id', async () => {
    let captured: HttpRequestConfig | undefined;
    const http = mockClient((config) => {
      captured = config;
      return {
        status: 201,
        data: { data: { id: 123, status: 'active', url: 'https://www.olx.pl/d/oferta/camera-123' } },
      };
    });
    const adapter = new OLXAdapter(http, fastOptions, realConfig);

    const result = await adapter.publish(publishInput);

    expect(result.externalListingId).toBe('123');
    expect(result.externalUrl).toBe('https://www.olx.pl/d/oferta/camera-123');
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(captured?.method).toBe('POST');
    expect(captured?.url).toBe('https://www.olx.pl/api/partner/adverts');
    const body = captured?.body as Record<string, unknown>;
    expect(body.title).toBe('Vintage Camera');
    expect(body.category_id).toBe(99);
    expect(body.advertiser_type).toBe('private');
    expect(body.price).toEqual({ value: 349.99, currency: 'PLN', negotiable: true });
    expect(body.location).toEqual({ city_id: 123, district_id: 456 });
    expect(body.contact).toEqual({ name: 'Seller', phone: '000000000' });
    expect(body.images).toEqual([{ url: 'https://img/1.jpg' }, { url: 'https://img/2.jpg' }]);
    expect(body.attributes).toEqual([
      { code: 'state', value: 'used' },
      { code: 'delivery', value: 'inpost-s' },
    ]);
  });

  it('maps a synced OLX ad without metrics as unavailable rather than zero', async () => {
    const http = mockClient(() => ({
      status: 200,
      data: { data: { id: 9, status: 'active', public_url: 'https://www.olx.pl/d/oferta/olx-9' } },
    }));
    const adapter = new OLXAdapter(http, fastOptions);

    const [synced] = await adapter.sync(['olx-9']);

    expect(synced).toEqual({
      externalListingId: '9',
      externalUrl: 'https://www.olx.pl/d/oferta/olx-9',
      status: 'live',
      remoteStatus: 'active',
      views: null,
      watchers: null,
      messages: null,
    });
  });

  it.each<[string, string]>([
    ['active', 'live'],
    ['new', 'live'],
    ['moderation', 'live'],
    ['limited', 'live'],
    ['expired', 'expired'],
    ['removed', 'expired'],
    ['deactivated', 'expired'],
    ['rejected', 'error'],
    ['blocked', 'error'],
  ])('maps OLX remote status %s to local status %s', async (remoteStatus, localStatus) => {
    const http = mockClient(() => ({
      status: 200,
      data: { data: { id: 9, status: remoteStatus } },
    }));
    const adapter = new OLXAdapter(http, fastOptions);

    const [synced] = await adapter.sync(['olx-9']);

    expect(synced).toMatchObject({
      externalListingId: '9',
      status: localStatus,
      remoteStatus,
    });
  });

  it('maps supported OLX engagement counters and parses numeric strings safely', async () => {
    const http = mockClient(() => ({
      status: 200,
      data: {
        data: {
          id: 9,
          status: 'active',
          metrics: { views: '42', favorites: 3, messages: 0 },
        },
      },
    }));
    const adapter = new OLXAdapter(http, fastOptions);

    const [synced] = await adapter.sync(['olx-9']);

    expect(synced).toMatchObject({
      externalListingId: '9',
      status: 'live',
      remoteStatus: 'active',
      views: 42,
      watchers: 3,
      messages: 0,
    });
  });

  it('maps OLX statistics-shaped engagement counters from live advert sync responses', async () => {
    const http = mockClient(() => ({
      status: 200,
      data: {
        data: {
          id: 1085426829,
          status: 'active',
          public_url: 'https://www.olx.pl/d/oferta/airpods-1085426829',
          statistics: { advert_views: '2', favorites_count: 0, contact_count: 0 },
        },
      },
    }));
    const adapter = new OLXAdapter(http, fastOptions);

    const [synced] = await adapter.sync(['1085426829']);

    expect(synced).toMatchObject({
      externalListingId: '1085426829',
      status: 'live',
      remoteStatus: 'active',
      views: 2,
      watchers: 0,
      messages: 0,
    });
  });

  it.each([
    ['empty string', ''],
    ['decimal string', '2.5'],
    ['negative string', '-1'],
    ['boolean', true],
    ['array', [2]],
    ['decimal number', 2.5],
    ['negative number', -1],
  ])('treats invalid OLX counter value %s as unavailable', async (_label, value) => {
    const http = mockClient(() => ({
      status: 200,
      data: {
        data: {
          id: 1085426829,
          status: 'active',
          statistics: { advert_views: value, favorites_count: value, contact_count: value },
        },
      },
    }));
    const adapter = new OLXAdapter(http, fastOptions);

    const [synced] = await adapter.sync(['1085426829']);

    expect(synced).toMatchObject({
      views: null,
      watchers: null,
      messages: null,
    });
  });

  it('discovers owned OLX adverts through paginated read-only list calls', async () => {
    const calls: HttpRequestConfig[] = [];
    const http = mockClient((config) => {
      calls.push(config);
      const page = config.query?.page;
      return {
        status: 200,
        data: {
          data:
            page === 1
              ? [
                  {
                    id: 10,
                    status: 'active',
                    title: 'Imported camera',
                    description: 'Remote description',
                    url: 'https://www.olx.pl/d/oferta/imported-camera',
                    price: { value: '149.50', currency: 'PLN' },
                    category: { name: 'Electronics' },
                    photos: [{ url: 'https://img/remote.jpg' }],
                    updated_at: '2026-07-15T00:00:00.000Z',
                    metrics: { views: 7, favorites: 2, messages: 1 },
                  },
                ]
              : [
                  {
                    id: 11,
                    status: 'active',
                    title: 'Imported lens',
                    public_url: 'https://www.olx.pl/d/oferta/imported-lens',
                    price: { value: '75', currency: 'PLN' },
                    category: { name: 'Photography' },
                    photos: [{ url: 'https://img/lens.jpg' }],
                  },
                ],
          meta: { last_page: 2 },
        },
      };
    });
    const adapter = new OLXAdapter(http, fastOptions);

    const adverts = await adapter.listOwnedListings({ pageSize: 50, statuses: ['active'] });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: 'https://www.olx.pl/api/partner/adverts',
      query: { page: 1, limit: 50, status: 'active' },
    });
    expect(calls[1]).toMatchObject({
      method: 'GET',
      url: 'https://www.olx.pl/api/partner/adverts',
      query: { page: 2, limit: 50, status: 'active' },
    });
    expect(adverts).toHaveLength(2);
    expect(adverts[0]).toMatchObject({
      externalListingId: '10',
      externalUrl: 'https://www.olx.pl/d/oferta/imported-camera',
      title: 'Imported camera',
      price: 149.5,
      currency: 'PLN',
      category: 'Electronics',
      imageUrls: ['https://img/remote.jpg'],
      metrics: { views: 7, watchers: 2, messages: 1 },
    });
    expect(adverts[1]).toMatchObject({
      externalListingId: '11',
      externalUrl: 'https://www.olx.pl/d/oferta/imported-lens',
      title: 'Imported lens',
      price: 75,
      currency: 'PLN',
      category: 'Photography',
      imageUrls: ['https://img/lens.jpg'],
    });
  });

  it('rejects unsafe external URLs from OLX responses instead of guessing links', async () => {
    const http = mockClient(() => ({
      status: 200,
      data: { data: { id: 9, status: 'active', url: 'http://evil.test/olx-9' } },
    }));
    const adapter = new OLXAdapter(http, fastOptions);

    const [synced] = await adapter.sync(['olx-9']);

    expect(synced.externalListingId).toBe('9');
    expect(synced.externalUrl).toBeNull();
  });

  it('returns a missing sync record for OLX 404 without hiding auth or transport failures', async () => {
    const http = mockClient((config) => {
      if (config.url.endsWith('/adverts/missing')) throw new HttpError(404, 'not found');
      if (config.url.endsWith('/adverts/rate-limited')) throw new HttpError(429, 'rate limited');
      return { status: 200, data: { data: { id: 'active', status: 'active' } } };
    });
    const adapter = new OLXAdapter(http, fastOptions);

    await expect(adapter.sync(['missing'])).resolves.toEqual([
      {
        externalListingId: 'missing',
        status: 'expired',
        remoteStatus: 'missing',
        missing: true,
        views: 0,
        watchers: 0,
        messages: 0,
      },
    ]);
    await expect(adapter.sync(['rate-limited'])).rejects.toBeInstanceOf(
      MarketplaceRateLimitError,
    );
  });

  it('uses the first safe OLX URL candidate when earlier candidates are invalid', async () => {
    const http = mockClient(() => ({
      status: 200,
      data: {
        data: {
          id: 9,
          status: 'active',
          url: 'http://evil.test/olx-9',
          public_url: 'https://www.olx.pl/d/oferta/olx-9',
        },
      },
    }));
    const adapter = new OLXAdapter(http, fastOptions);

    const [synced] = await adapter.sync(['olx-9']);

    expect(synced.externalUrl).toBe('https://www.olx.pl/d/oferta/olx-9');
  });

  it('treats invalid, negative, and schema-changed OLX counters as unavailable', async () => {
    const http = mockClient(() => ({
      status: 200,
      data: {
        data: {
          id: 9,
          status: 'active',
          metrics: { views: -1, favorites: 'not-a-number', messages: { count: 2 } },
        },
      },
    }));
    const adapter = new OLXAdapter(http, fastOptions);

    const [synced] = await adapter.sync(['olx-9']);

    expect(synced).toMatchObject({ views: null, watchers: null, messages: null });
  });

  it('fails closed before a live publish when required OLX details are missing', async () => {
    const request = jest.fn();
    const adapter = new OLXAdapter(
      { request } as unknown as MarketplaceHttpClient,
      fastOptions,
      { requirePublishDetails: true },
    );

    await expect(adapter.publish(publishInput)).rejects.toThrow('category id');
    expect(request).not.toHaveBeenCalled();
  });

  it('returns [] for sync with no ids without calling the transport', async () => {
    const request = jest.fn();
    const adapter = new OLXAdapter({ request } as unknown as MarketplaceHttpClient, fastOptions);
    await expect(adapter.sync([])).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('normalizes 401 to MarketplaceAuthenticationError', async () => {
    const adapter = new OLXAdapter(
      mockClient(() => {
        throw new HttpError(401, 'unauthorized');
      }),
      fastOptions,
    );
    await expect(adapter.publish(publishInput)).rejects.toBeInstanceOf(
      MarketplaceAuthenticationError,
    );
  });

  it('returns null when fetching a missing OLX advert', async () => {
    const adapter = new OLXAdapter(
      mockClient(() => {
        throw new HttpError(404, 'missing');
      }),
      fastOptions,
    );
    await expect(adapter.fetchListing('nope')).resolves.toBeNull();
  });

  it('preserves sanitized provider validation details for a 400 response', async () => {
    const adapter = new OLXAdapter(
      mockClient(() => {
        throw new HttpError(400, 'Bad Request', {
          error: { message: 'invalid category', phone: '+48123456789' },
        });
      }),
      fastOptions,
    );

    const error = await adapter.publish(publishInput).catch((caught) => caught as Error);
    expect(error.message).toContain('invalid category');
    expect(error.message).toContain('[REDACTED]');
    expect(error.message).not.toContain('+48123456789');
  });

  it('redacts sensitive provider field-name variants', async () => {
    const adapter = new OLXAdapter(
      mockClient(() => {
        throw new HttpError(400, 'Bad Request', {
          phone_number: '+48111111111',
          contactPhone: '+48222222222',
          seller_email: 'seller@example.test',
          client_secret_id: 'secret-id',
        });
      }),
      fastOptions,
    );

    const error = await adapter.publish(publishInput).catch((caught) => caught as Error);
    expect(error.message.match(/\[REDACTED\]/g)).toHaveLength(4);
    expect(error.message).not.toContain('+48111111111');
    expect(error.message).not.toContain('seller@example.test');
    expect(error.message).not.toContain('secret-id');
  });

  it('preserves configured price negotiability on updates', async () => {
    let captured: HttpRequestConfig | undefined;
    const adapter = new OLXAdapter(
      mockClient((config) => {
        captured = config;
        return { status: 204, data: {} };
      }),
      fastOptions,
      realConfig,
    );

    await adapter.updateListing('olx-1', { price: 299 });

    expect((captured?.body as Record<string, unknown>).price).toEqual({
      value: 299,
      currency: 'PLN',
      negotiable: true,
    });
  });

  it('retries retryable rate-limit failures then succeeds (idempotent updateListing)', async () => {
    let calls = 0;
    const http = mockClient(() => {
      calls += 1;
      if (calls < 3) throw new HttpError(429, 'slow down');
      return { status: 200, data: { id: 'olx-ok', status: 'active' } };
    });
    const adapter = new OLXAdapter(http, fastOptions);

    await expect(
      adapter.updateListing('olx-ok', { price: 10 }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });

  it('gives up after exhausting retries and throws the rate-limit error (updateListing)', async () => {
    const http = mockClient(() => {
      throw new HttpError(429, 'slow down');
    });
    const adapter = new OLXAdapter(http, { ...fastOptions, maxRetries: 1 });
    await expect(
      adapter.updateListing('olx-1', { price: 10 }),
    ).rejects.toBeInstanceOf(MarketplaceRateLimitError);
  });

  // CR2: publish is a non-idempotent POST that creates a remote listing. It must
  // NOT auto-retry on an ambiguous failure, or a lost-response retry would create
  // a duplicate listing. It should hit the transport exactly once and surface the
  // error immediately.
  it('does NOT retry publish on a 5xx failure (no duplicate POST)', async () => {
    let calls = 0;
    const http = mockClient(() => {
      calls += 1;
      throw new HttpError(500, 'server error');
    });
    const adapter = new OLXAdapter(http, fastOptions);

    await expect(adapter.publish(publishInput)).rejects.toBeInstanceOf(
      MarketplaceTransientError,
    );
    expect(calls).toBe(1);
  });

  it('does NOT retry publish on a 429 failure (no duplicate POST)', async () => {
    let calls = 0;
    const http = mockClient(() => {
      calls += 1;
      throw new HttpError(429, 'slow down');
    });
    const adapter = new OLXAdapter(http, fastOptions);

    await expect(adapter.publish(publishInput)).rejects.toBeInstanceOf(
      MarketplaceRateLimitError,
    );
    expect(calls).toBe(1);
  });

  it('works against its default stub transport with no injected client', async () => {
    const adapter = new OLXAdapter(undefined, fastOptions);
    const published = await adapter.publish(publishInput);
    expect(published.externalListingId).toMatch(/^olx-/);
    const fetched = await adapter.fetchListing('olx-abc');
    expect(fetched?.status).toBe('live');
  });
});
