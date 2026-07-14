import { HttpError, type HttpRequestConfig, type HttpResponse, type MarketplaceHttpClient } from './MarketplaceHttpClient';

export interface FetchMarketplaceHttpClientOptions {
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Safety gate for non-idempotent marketplace listing creation. Keep false until
   * the seller explicitly approves a live publish attempt.
   */
  livePublishEnabled?: boolean;
}

function withQuery(url: string, query?: HttpRequestConfig['query']): string {
  if (!query) return url;
  const next = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) next.searchParams.set(key, String(value));
  }
  return next.toString();
}

function isCreateListingRequest(config: HttpRequestConfig): boolean {
  if (config.method !== 'POST') return false;
  const pathname = new URL(config.url).pathname.replace(/\/$/, '');
  return pathname.endsWith('/user/ads') || pathname.endsWith('/api/partner/adverts');
}

/**
 * Generic fetch-backed transport for real marketplace APIs. It is intentionally
 * opt-in: adapters still default to deterministic stubs unless DI wires this in.
 */
export class FetchMarketplaceHttpClient implements MarketplaceHttpClient {
  constructor(private readonly options: FetchMarketplaceHttpClientOptions = {}) {}

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    if (isCreateListingRequest(config) && this.options.livePublishEnabled !== true) {
      throw new HttpError(
        412,
        'Live marketplace publish is disabled by OLX_LIVE_PUBLISH_ENABLED=false',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    );

    try {
      const response = await fetch(withQuery(config.url, config.query), {
        method: config.method,
        headers: {
          Accept: 'application/json',
          ...(config.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...this.options.defaultHeaders,
          ...config.headers,
        },
        body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const data = text ? this.parseResponseBody(text) : null;
      if (!response.ok) {
        throw new HttpError(response.status, response.statusText, data);
      }
      return { status: response.status, data: data as T };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HttpError(504, 'Marketplace request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResponseBody(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
