// Thin, injectable HTTP boundary for marketplace adapters. Concrete adapters
// build requests and parse responses; the transport itself is swappable so unit
// tests never touch the network. A real implementation (axios/fetch) would be
// wired in Group 6 DI; here we ship a deterministic in-memory stub so adapters
// are exercisable without calling real marketplace APIs.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequestConfig {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
}

export interface MarketplaceHttpClient {
  request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>>;
}

// Transport-level failure. Non-2xx responses throw this so the adapter base can
// normalize it into a domain-agnostic MarketplaceError.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

export type StubResponder = (config: HttpRequestConfig) => HttpResponse | Promise<HttpResponse>;

// Deterministic stub transport. Each adapter supplies a responder that returns
// marketplace-shaped payloads, keeping the mapping logic realistic without a
// real network dependency.
export class StubMarketplaceHttpClient implements MarketplaceHttpClient {
  constructor(private readonly responder: StubResponder) {}

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const response = await this.responder(config);
    return response as HttpResponse<T>;
  }
}
