import { OlxOAuthClient } from '../OlxOAuthClient';

describe('OlxOAuthClient', () => {
  const config = {
    authorizationUrl: 'https://www.olx.pl/oauth/authorize',
    tokenUrl: 'https://www.olx.pl/oauth/token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://marketdesk.example/api/marketplaces/olx/oauth/callback',
    scopes: ['basic', 'write'],
  };

  it('builds an authorization URL with state and the registered redirect URI', () => {
    const client = new OlxOAuthClient(config, jest.fn() as unknown as typeof fetch);

    const url = new URL(client.buildAuthorizationUrl('state-value'));

    expect(url.origin + url.pathname).toBe(config.authorizationUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(config.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('scope')).toBe('basic write');
    expect(url.searchParams.get('state')).toBe('state-value');
  });

  it('classifies missing configuration as a configuration error', () => {
    const client = new OlxOAuthClient(
      { ...config, clientId: '' },
      jest.fn() as unknown as typeof fetch,
    );

    expect(() => client.buildAuthorizationUrl('state-value')).toThrow(
      expect.objectContaining({ code: 'CONFIGURATION_ERROR' }),
    );
  });

  it('exchanges an authorization code using a form-encoded token request', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'basic write',
        }),
    }));
    const client = new OlxOAuthClient(
      { ...config, now: () => new Date('2026-07-14T12:00:00.000Z') },
      fetchMock as unknown as typeof fetch,
    );

    const tokens = await client.exchangeAuthorizationCode('authorization-code');

    expect(tokens).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'Bearer',
      scopes: ['basic', 'write'],
      expiresAt: new Date('2026-07-14T13:00:00.000Z'),
      accountHandle: undefined,
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('authorization-code');
    expect(body.get('client_secret')).toBe(config.clientSecret);
    expect(body.get('redirect_uri')).toBe(config.redirectUri);
  });

  it('does not expose provider bodies or client secrets in token errors', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'invalid_client', client_secret: 'leak-me' }),
    }));
    const client = new OlxOAuthClient(config, fetchMock as unknown as typeof fetch);

    await expect(client.exchangeAuthorizationCode('bad-code')).rejects.toThrow(
      'OLX token endpoint returned HTTP 401',
    );
    await client.exchangeAuthorizationCode('bad-code').catch((error: Error) => {
      expect(error.message).not.toContain('leak-me');
      expect(error.message).not.toContain(config.clientSecret);
    });
  });
});
