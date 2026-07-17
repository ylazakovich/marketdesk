import { connectionStringWithoutSslOptions, databaseSslConfig } from '../database';
import { migrationPoolConfig } from '../databaseConfig';

describe('databaseSslConfig', () => {
  it('uses plaintext when TLS is explicitly disabled', () => {
    expect(databaseSslConfig('disable')).toBe(false);
  });

  it('always verifies the server certificate when TLS is enabled', () => {
    expect(databaseSslConfig('verify-full')).toEqual({ rejectUnauthorized: true });
  });

  it('prevents DATABASE_URL parameters from overriding the explicit TLS mode', () => {
    const connectionString = connectionStringWithoutSslOptions(
      'postgresql://user:***@db.example.com/app?application_name=marketdesk&sslmode=no-verify&ssl=true',
    );
    const parsed = new URL(connectionString);

    expect(parsed.searchParams.get('application_name')).toBe('marketdesk');
    expect(parsed.searchParams.has('sslmode')).toBe(false);
    expect(parsed.searchParams.has('ssl')).toBe(false);
    expect(databaseSslConfig('verify-full')).toEqual({ rejectUnauthorized: true });
  });
});

describe('migrationPoolConfig', () => {
  it('uses only database settings and preserves verified TLS policy', () => {
    const config = migrationPoolConfig({
      NODE_ENV: 'production',
      DB_SSL_MODE: 'verify-full',
      DATABASE_URL: 'postgresql://user:***@db.example.com/app?sslmode=no-verify',
    });

    expect(config.connectionString).not.toContain('sslmode');
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.application_name).toBe('hermes-marketdesk-migrations');
    expect(config.max).toBe(2);
  });

  it('does not require application secrets for an internal production database', () => {
    expect(migrationPoolConfig({
      NODE_ENV: 'production',
      DB_SSL_MODE: 'disable',
      DB_HOST: 'postgres',
      DB_USER: 'marketdesk',
      DB_PASSWORD: 'database-only-secret',
      DB_NAME: 'marketdesk',
    })).toMatchObject({
      host: 'postgres',
      user: 'marketdesk',
      database: 'marketdesk',
      ssl: false,
    });
  });

  it('fails closed when production TLS mode is missing', () => {
    expect(() => migrationPoolConfig({ NODE_ENV: 'production' })).toThrow(/DB_SSL_MODE/);
  });

  it.each(['5432junk', '1.5', '0', '65536', '-1'])(
    'rejects malformed migration DB port %s',
    (port) => {
      expect(() => migrationPoolConfig({
        NODE_ENV: 'production',
        DB_SSL_MODE: 'disable',
        DB_PORT: port,
      })).toThrow(/DB_PORT/);
    },
  );
});
