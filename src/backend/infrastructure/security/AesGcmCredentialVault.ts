import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import type {
  MarketplaceCredentialVault,
  OlxOAuthTokens,
} from '../../application/services/MarketplaceOAuthService';

interface CredentialEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
}

function isEnvelope(value: Record<string, unknown>): value is Record<string, unknown> & CredentialEnvelope {
  return (
    value.version === 1 &&
    value.algorithm === 'aes-256-gcm' &&
    typeof value.iv === 'string' &&
    typeof value.authTag === 'string' &&
    typeof value.ciphertext === 'string'
  );
}

export class AesGcmCredentialVault implements MarketplaceCredentialVault {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    this.key = AesGcmCredentialVault.decodeKey(encodedKey);
  }

  encrypt(tokens: OlxOAuthTokens): Record<string, unknown> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(tokens), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    } satisfies CredentialEnvelope;
  }

  decrypt(credentials: Record<string, unknown>): OlxOAuthTokens {
    if (!isEnvelope(credentials)) {
      throw new Error('Unsupported marketplace credential envelope');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(credentials.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(credentials.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(credentials.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const decoded = JSON.parse(plaintext) as Omit<OlxOAuthTokens, 'expiresAt'> & {
      expiresAt: string;
    };
    return { ...decoded, expiresAt: new Date(decoded.expiresAt) };
  }

  private static decodeKey(encodedKey: string): Buffer {
    const key = Buffer.from(encodedKey, 'base64');
    if (!encodedKey || key.length !== 32) {
      throw new Error(
        'MARKETPLACE_CREDENTIALS_KEY must be a base64-encoded 32-byte key',
      );
    }
    return key;
  }
}
