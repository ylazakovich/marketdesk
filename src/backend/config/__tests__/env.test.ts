// S1: the JWT secret resolver must fail-closed in production and return a
// clearly-marked dev-only value outside production.

import { positiveInt, resolveDatabaseSslMode, resolveJwtSecret } from '../env';

describe('resolveDatabaseSslMode', () => {
  it('allows production to explicitly disable TLS for internal Compose PostgreSQL', () => {
    expect(resolveDatabaseSslMode('disable', true)).toBe('disable');
  });

  it('enables verified TLS explicitly in production', () => {
    expect(resolveDatabaseSslMode('verify-full', true)).toBe('verify-full');
  });

  it.each([undefined, '', '   '])('rejects a missing production mode: %p', (value) => {
    expect(() => resolveDatabaseSslMode(value, true)).toThrow(/DB_SSL_MODE/);
  });

  it.each(['require', 'verify-ca', 'true', 'DISABLE'])(
    'rejects invalid mode %s',
    (value) => {
      expect(() => resolveDatabaseSslMode(value, true)).toThrow(/DB_SSL_MODE/);
    },
  );

  it('defaults to plaintext outside production for ergonomic local and test use', () => {
    expect(resolveDatabaseSslMode(undefined, false)).toBe('disable');
  });
});

describe('positiveInt', () => {
  it('returns a configured positive integer or the fallback', () => {
    expect(positiveInt('4096', 1024, 'MAX_FILE_SIZE')).toBe(4096);
    expect(positiveInt(undefined, 1024, 'MAX_FILE_SIZE')).toBe(1024);
  });

  it.each(['abc', '12abc', '0', '-1', '1.5', '9007199254740992'])(
    'rejects invalid configured value %s',
    (value) => {
      expect(() => positiveInt(value, 1024, 'MAX_FILE_SIZE')).toThrow(/positive integer/);
    },
  );
});

describe('resolveJwtSecret (S1 fail-closed JWT secret)', () => {
  describe('production', () => {
    const PROD = true;

    it('throws when the secret is unset', () => {
      expect(() => resolveJwtSecret(undefined, 'JWT_SECRET', PROD)).toThrow(
        /JWT_SECRET/,
      );
    });

    it('throws when the secret is an empty string', () => {
      expect(() => resolveJwtSecret('', 'JWT_SECRET', PROD)).toThrow(/JWT_SECRET/);
    });

    it('throws when the secret is still a your_-prefixed placeholder', () => {
      expect(() =>
        resolveJwtSecret('your_jwt_secret_key_change_in_production', 'JWT_SECRET', PROD),
      ).toThrow(/JWT_SECRET/);
    });

    it('returns a real, non-placeholder secret unchanged', () => {
      expect(
        resolveJwtSecret('a-strong-production-secret-value', 'JWT_SECRET', PROD),
      ).toBe('a-strong-production-secret-value');
    });
  });

  describe('development', () => {
    const DEV = false;

    it('returns a clearly-marked dev-only value when unset', () => {
      const secret = resolveJwtSecret(undefined, 'JWT_SECRET', DEV);
      expect(secret).toContain('dev-only-insecure');
    });

    it('does not fall back to a your_-prefixed placeholder', () => {
      const secret = resolveJwtSecret('your_placeholder', 'JWT_SECRET', DEV);
      expect(secret.startsWith('your_')).toBe(false);
      expect(secret).toContain('dev-only-insecure');
    });

    it('returns a real configured secret unchanged', () => {
      expect(resolveJwtSecret('my-dev-secret', 'JWT_SECRET', DEV)).toBe('my-dev-secret');
    });
  });
});
