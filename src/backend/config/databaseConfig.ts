import type { PoolConfig } from 'pg';

export type DatabaseSslMode = 'disable' | 'verify-full';

export function resolveDatabaseSslMode(
  value: string | undefined,
  isProd: boolean,
): DatabaseSslMode {
  const mode = value?.trim();
  if (!mode) {
    if (isProd) {
      throw new Error(
        'DB_SSL_MODE must be set in production (use "disable" or "verify-full")',
      );
    }
    return 'disable';
  }
  if (mode !== 'disable' && mode !== 'verify-full') {
    throw new Error('DB_SSL_MODE must be either "disable" or "verify-full"');
  }
  return mode;
}

export function databaseSslConfig(mode: DatabaseSslMode): PoolConfig['ssl'] {
  return mode === 'verify-full' ? { rejectUnauthorized: true } : false;
}

export function connectionStringWithoutSslOptions(connectionString: string): string {
  const parsed = new URL(connectionString);
  // node-postgres lets TLS query parameters override the top-level `ssl` option.
  // Remove every such escape hatch so DB_SSL_MODE remains authoritative.
  for (const parameter of [
    'ssl',
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'sslnegotiation',
    'uselibpqcompat',
  ]) {
    parsed.searchParams.delete(parameter);
  }
  return parsed.toString();
}

function positivePort(value: string | undefined): number {
  const rawPort = value?.trim() || '5432';
  if (!/^\d+$/.test(rawPort)) {
    throw new Error('DB_PORT must be a valid TCP port');
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port');
  }
  return port;
}

export function migrationPoolConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const sslMode = resolveDatabaseSslMode(
    environment.DB_SSL_MODE,
    environment.NODE_ENV === 'production',
  );
  const connectionString = environment.DATABASE_URL?.trim();

  return {
    ...(connectionString
      ? { connectionString: connectionStringWithoutSslOptions(connectionString) }
      : {
          host: environment.DB_HOST || 'localhost',
          port: positivePort(environment.DB_PORT),
          user: environment.DB_USER || 'marketdesk',
          password: environment.DB_PASSWORD || 'marketdesk',
          database: environment.DB_NAME || 'marketdesk',
        }),
    min: 0,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'hermes-marketdesk-migrations',
    ssl: databaseSslConfig(sslMode),
  };
}
