import { createCorsOptions } from '../app';

describe('createCorsOptions', () => {
  function resolveOrigin(
    config: string | undefined,
    requestOrigin?: string,
    isProduction = false,
  ): Promise<unknown> {
    const origin = createCorsOptions(config, isProduction).origin;
    if (typeof origin !== 'function') throw new Error('expected functional CORS origin');
    return new Promise((resolve, reject) => {
      origin(requestOrigin, (error, value) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
  }

  it('allows exact configured origins', async () => {
    await expect(
      resolveOrigin('https://app.example.com, https://admin.example.com', 'https://admin.example.com'),
    ).resolves.toBe('https://admin.example.com');
  });

  it('denies origins outside the allowlist', async () => {
    await expect(
      resolveOrigin('https://app.example.com', 'https://evil.example.com'),
    ).resolves.toBe(false);
  });

  it('does not treat wildcard config as a credentialed wildcard origin', async () => {
    await expect(resolveOrigin('*', 'https://evil.example.com')).resolves.toBe(false);
    await expect(resolveOrigin('*', 'http://localhost:5173')).resolves.toBe('http://localhost:5173');
  });

  it('allows same-origin/server-to-server requests with no Origin header', async () => {
    await expect(resolveOrigin('https://app.example.com', undefined)).resolves.toBe(true);
  });

  it('rejects missing CORS_ORIGIN in production', () => {
    expect(() => createCorsOptions(undefined, true)).toThrow(
      'CORS_ORIGIN in production must be an explicit, non-wildcard allowlist',
    );
  });

  it('rejects wildcard-only CORS_ORIGIN in production', () => {
    expect(() => createCorsOptions('*', true)).toThrow(
      'CORS_ORIGIN in production must be an explicit, non-wildcard allowlist',
    );
  });

  it('rejects blank CORS_ORIGIN in production', () => {
    expect(() => createCorsOptions('   ', true)).toThrow(
      'CORS_ORIGIN in production must be an explicit, non-wildcard allowlist',
    );
  });
});
