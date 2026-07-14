import { AesGcmCredentialVault } from '../AesGcmCredentialVault';
import type { OlxOAuthTokens } from '../../../application/services/MarketplaceOAuthService';

describe('AesGcmCredentialVault', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const tokens: OlxOAuthTokens = {
    accessToken: 'sensitive-access-token',
    refreshToken: 'sensitive-refresh-token',
    tokenType: 'Bearer',
    scopes: ['basic', 'write'],
    expiresAt: new Date('2026-07-14T13:00:00.000Z'),
  };

  it('round-trips OAuth credentials without storing plaintext', () => {
    const vault = new AesGcmCredentialVault(key);

    const encrypted = vault.encrypt(tokens);
    const serialized = JSON.stringify(encrypted);

    expect(serialized).not.toContain(tokens.accessToken);
    expect(serialized).not.toContain(tokens.refreshToken);
    expect(vault.decrypt(encrypted)).toEqual(tokens);
  });

  it('fails closed when the configured key is missing or malformed', () => {
    expect(() => new AesGcmCredentialVault('')).toThrow('MARKETPLACE_CREDENTIALS_KEY');
    expect(() => new AesGcmCredentialVault('not-base64')).toThrow(
      'MARKETPLACE_CREDENTIALS_KEY',
    );
  });
});
