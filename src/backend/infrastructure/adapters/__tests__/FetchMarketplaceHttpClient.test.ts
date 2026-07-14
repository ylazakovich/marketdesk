import { FetchMarketplaceHttpClient } from '../FetchMarketplaceHttpClient';
import { HttpError } from '../MarketplaceHttpClient';

describe('FetchMarketplaceHttpClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('adds default headers and serializes JSON requests', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'ad-1' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new FetchMarketplaceHttpClient({
      defaultHeaders: { Authorization: 'Bearer token' },
    });

    const res = await client.request<{ id: string }>({
      method: 'PUT',
      url: 'https://api.olx.pl/v1/user/ads/ad-1',
      body: { title: 'AirPods 4' },
    });

    expect(res.data.id).toBe('ad-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.olx.pl/v1/user/ads/ad-1',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ title: 'AirPods 4' }),
      }),
    );
  });

  it.each([
    'https://api.olx.pl/v1/user/ads',
    'https://www.olx.pl/api/partner/adverts',
  ])('blocks live OLX create-listing POST unless explicitly enabled: %s', async (url) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new FetchMarketplaceHttpClient({ livePublishEnabled: false });

    await expect(
      client.request({
        method: 'POST',
        url,
        body: { title: 'AirPods 4' },
      }),
    ).rejects.toMatchObject({ status: 412 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes non-2xx responses into HttpError', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: 'invalid_token' }),
    }) as unknown as typeof fetch;

    const client = new FetchMarketplaceHttpClient({ livePublishEnabled: true });

    await expect(
      client.request({ method: 'GET', url: 'https://api.olx.pl/v1/user/ads/ad-1' }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
