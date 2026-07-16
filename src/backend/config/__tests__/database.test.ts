import { connectionStringWithoutSslOptions, databaseSslConfig } from '../database';

describe('databaseSslConfig', () => {
  it('uses plaintext when TLS is explicitly disabled', () => {
    expect(databaseSslConfig('disable')).toBe(false);
  });

  it('always verifies the server certificate when TLS is enabled', () => {
    expect(databaseSslConfig('verify-full')).toEqual({ rejectUnauthorized: true });
  });

  it('prevents DATABASE_URL parameters from overriding the explicit TLS mode', () => {
    const connectionString = connectionStringWithoutSslOptions(
      'postgresql://user:password@db.example.com/app?application_name=marketdesk&sslmode=no-verify&ssl=true',
    );
    const parsed = new URL(connectionString);

    expect(parsed.searchParams.get('application_name')).toBe('marketdesk');
    expect(parsed.searchParams.has('sslmode')).toBe(false);
    expect(parsed.searchParams.has('ssl')).toBe(false);
    expect(databaseSslConfig('verify-full')).toEqual({ rejectUnauthorized: true });
  });
});