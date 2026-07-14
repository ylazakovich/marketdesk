import type {
  OlxOAuthClientPort,
  OlxOAuthTokens,
} from '../../application/services/MarketplaceOAuthService';
import { ConfigurationError } from '../../domain/shared/DomainError';

interface OlxOAuthClientConfig {
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  timeoutMs?: number;
  now?: () => Date;
}

interface OlxTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  user_id?: unknown;
  account_id?: unknown;
}

function requiredConfig(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ConfigurationError(`${name} is not configured`);
  return trimmed;
}

function parseScopes(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === 'string' && Boolean(scope));
  }
  if (typeof value === 'string') {
    return value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
  }
  return [...fallback];
}

export class OlxOAuthClient implements OlxOAuthClientPort {
  private readonly now: () => Date;

  constructor(
    private readonly config: OlxOAuthClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.now = config.now ?? (() => new Date());
  }

  buildAuthorizationUrl(state: string): string {
    const url = new URL(requiredConfig(this.config.authorizationUrl, 'OLX_AUTH_URL'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', requiredConfig(this.config.clientId, 'OLX_CLIENT_ID'));
    url.searchParams.set(
      'redirect_uri',
      requiredConfig(this.config.redirectUri, 'OLX_REDIRECT_URI'),
    );
    url.searchParams.set('scope', this.config.scopes.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  }

  exchangeAuthorizationCode(code: string): Promise<OlxOAuthTokens> {
    return this.requestTokens({
      grant_type: 'authorization_code',
      code,
      redirect_uri: requiredConfig(this.config.redirectUri, 'OLX_REDIRECT_URI'),
    });
  }

  refreshAccessToken(refreshToken: string): Promise<OlxOAuthTokens> {
    return this.requestTokens({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  private async requestTokens(grant: Record<string, string>): Promise<OlxOAuthTokens> {
    const body = new URLSearchParams({
      ...grant,
      client_id: requiredConfig(this.config.clientId, 'OLX_CLIENT_ID'),
      client_secret: requiredConfig(this.config.clientSecret, 'OLX_CLIENT_SECRET'),
    });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 30_000,
    );

    try {
      const response = await this.fetchImpl(
        requiredConfig(this.config.tokenUrl, 'OLX_TOKEN_URL'),
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal: controller.signal,
        },
      );
      const text = await response.text();
      if (!response.ok) {
        // Provider bodies may contain diagnostic or credential material. Keep them
        // out of application errors/logs and expose only the status code.
        throw new Error(`OLX token endpoint returned HTTP ${response.status}`);
      }

      let payload: OlxTokenResponse;
      try {
        payload = text ? (JSON.parse(text) as OlxTokenResponse) : {};
      } catch {
        throw new Error('OLX token endpoint returned invalid JSON');
      }
      if (typeof payload.access_token !== 'string' || !payload.access_token) {
        throw new Error('OLX token response did not include an access token');
      }
      const expiresIn = Number(payload.expires_in ?? 3600);
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new Error('OLX token response included an invalid expiry');
      }
      const accountHandle =
        typeof payload.user_id === 'string' || typeof payload.user_id === 'number'
          ? String(payload.user_id)
          : typeof payload.account_id === 'string' || typeof payload.account_id === 'number'
            ? String(payload.account_id)
            : undefined;

      return {
        accessToken: payload.access_token,
        refreshToken:
          typeof payload.refresh_token === 'string' && payload.refresh_token
            ? payload.refresh_token
            : undefined,
        tokenType:
          typeof payload.token_type === 'string' && payload.token_type
            ? payload.token_type
            : 'Bearer',
        scopes: parseScopes(payload.scope, this.config.scopes),
        expiresAt: new Date(this.now().getTime() + expiresIn * 1000),
        accountHandle,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('OLX token endpoint timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type { OlxOAuthClientConfig };
