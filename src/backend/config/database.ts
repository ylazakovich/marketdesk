import { Pool, PoolClient, type PoolConfig } from 'pg';
import { env, type DatabaseSslMode } from './env.js';
import pino from 'pino';

const logger = pino({
  level: env.logLevel,
});

let pool: Pool | null = null;

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

export function createPool(): Pool {
  if (pool) {
    return pool;
  }

  pool = new Pool({
    ...(env.database.url
      ? { connectionString: connectionStringWithoutSslOptions(env.database.url) }
      : {
          host: env.database.host,
          port: env.database.port,
          user: env.database.user,
          password: env.database.password,
          database: env.database.name,
        }),
    min: env.database.poolMin,
    max: env.database.poolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: env.appName,
    ssl: databaseSslConfig(env.database.sslMode),
  });

  pool.on('error', (err: Error) => {
    // Log only. A config module must never call process.exit — the entry point
    // (main.ts) owns process lifecycle and graceful shutdown. pg will discard the
    // broken idle client and open a fresh one on the next checkout.
    logger.error({ error: err }, 'Unexpected error on idle client');
  });

  return pool;
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    createPool();
  }
  return pool!;
}

export async function query<T = any>(
  text: string,
  values?: any[],
  client?: PoolClient | Pool,
): Promise<{ rows: T[]; rowCount: number }> {
  const currentPool = client || (await getPool());

  try {
    const start = Date.now();
    const result = await currentPool.query(text, values);
    const duration = Date.now() - start;

    if (duration > 1000) {
      // Never log the values array — it carries bcrypt hashes, PII and prices.
      // The param count is enough to correlate with the query text. (S3)
      logger.warn(
        { duration, query: text, paramCount: values?.length ?? 0, values: '[redacted]' },
        'Slow query detected',
      );
    }

    return {
      rows: result.rows as T[],
      rowCount: result.rowCount || 0,
    };
  } catch (error) {
    // Redact bound values here too (S3).
    logger.error(
      { error, query: text, paramCount: values?.length ?? 0, values: '[redacted]' },
      'Database query error',
    );
    throw error;
  }
}

export async function getClient(): Promise<PoolClient> {
  const currentPool = await getPool();
  return currentPool.connect();
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getClient();
  let releaseError: Error | undefined;

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
      logger.error({ error }, 'Transaction rolled back');
    } catch (rollbackError) {
      logger.error({ error, rollbackError }, 'Transaction rollback failed');
      releaseError = rollbackError instanceof Error ? rollbackError : new Error('Transaction rollback failed');
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

// Closes the shared pg pool. Signal handling and process exit are owned solely
// by the entry point (main.ts); this config module never registers process
// signal handlers nor calls process.exit — doing so would race the entry
// point's ordered graceful shutdown.
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection pool closed');
  }
}
