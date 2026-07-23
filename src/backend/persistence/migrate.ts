import path from 'path';
import fs from 'fs';
import { Pool, type PoolClient } from 'pg';
import dotenv from 'dotenv';
import { migrationPoolConfig } from '../config/databaseConfig.js';
import { safeErrorDetails } from '../config/safeErrorDetails.js';
import { concurrentIndexIdentity, quotedIndexIdentity } from './migrationSql.js';
import { orderedMigrationFiles } from './migrationFiles.js';
import pino from 'pino';
import { pathToFileURL } from 'node:url';

dotenv.config();
const logger = pino();
const migrationsDir = process.env.MARKETDESK_MIGRATIONS_DIR
  ? path.resolve(process.env.MARKETDESK_MIGRATIONS_DIR)
  : path.join(process.cwd(), 'src/backend/persistence/migrations');
const MIGRATION_LOCK_KEY = 'marketdesk:migrations';
const CONNECTION_ATTEMPTS = 30;
const CONNECTION_RETRY_MS = 1_000;
const sensitiveValues = [process.env.DATABASE_URL, process.env.DB_PASSWORD];
const LISTING_CONVERSATIONS_MIGRATION = '040_listing_conversations.sql';
const LISTING_CONVERSATIONS_SQL = 'ALTER TABLE listings\n  ADD COLUMN conversations INT;';

function normalizedSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

async function connectWithRetry(pool: Pool): Promise<PoolClient> {
  for (let attempt = 1; attempt <= CONNECTION_ATTEMPTS; attempt += 1) {
    try {
      return await pool.connect();
    } catch (error) {
      if (attempt === CONNECTION_ATTEMPTS) throw error;
      logger.warn(
        { attempt, attempts: CONNECTION_ATTEMPTS },
        'Database is not ready for migrations; retrying',
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, CONNECTION_RETRY_MS));
    }
  }
  throw new Error('Database connection retry loop exhausted');
}

function isDuplicateColumnError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42701';
}

async function shouldSkipAlreadyAppliedListingConversationsMigration(
  client: PoolClient,
  file: string,
  sql: string,
  error: unknown,
): Promise<boolean> {
  if (file !== LISTING_CONVERSATIONS_MIGRATION || !isDuplicateColumnError(error)) return false;

  if (normalizedSql(sql) !== normalizedSql(LISTING_CONVERSATIONS_SQL)) {
    const shapeError = new Error(
      `${LISTING_CONVERSATIONS_MIGRATION} has an unexpected shape; refusing duplicate-column replay skip`,
    ) as Error & { cause?: unknown };
    shapeError.cause = error;
    throw shapeError;
  }

  const column = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_attribute
        WHERE attrelid = 'listings'::regclass
          AND attname = 'conversations'
          AND NOT attisdropped
     ) AS exists`,
  );

  if (column.rows[0]?.exists === true) return true;

  const replayError = new Error(
    `${LISTING_CONVERSATIONS_MIGRATION} raised duplicate_column but listings.conversations is not present`,
  ) as Error & { cause?: unknown };
  replayError.cause = error;
  throw replayError;
}

export async function runMigrationFile(
  client: PoolClient,
  file: string,
  sql: string,
): Promise<void> {
  const concurrentIndex = concurrentIndexIdentity(sql);
  if (concurrentIndex) {
    // Concurrent index DDL must run outside a transaction. Invalid remnants
    // are inspected and removed under the same suite-wide session lock.
    const validity = await client.query<{ indisvalid: boolean }>(
      `SELECT index.indisvalid
         FROM pg_class relation
         JOIN pg_index index ON index.indexrelid = relation.oid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE relation.relname = $1
          AND (($2::text IS NULL AND pg_table_is_visible(relation.oid))
            OR namespace.nspname = $2)`,
      [concurrentIndex.name, concurrentIndex.schema ?? null]
    );
    if (validity.rows[0] && !validity.rows[0].indisvalid) {
      await client.query(
        `DROP INDEX CONCURRENTLY IF EXISTS ${quotedIndexIdentity(concurrentIndex)}`,
      );
    }
    await client.query(sql);
  } else {
    try {
      await client.query(sql);
    } catch (error) {
      if (await shouldSkipAlreadyAppliedListingConversationsMigration(client, file, sql, error)) return;
      throw error;
    }
  }
}

export async function runMigrations() {
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let locked = false;

  try {
    pool = new Pool(migrationPoolConfig());
    logger.info('Starting database migrations...');

    // Get all migration files
    const files = orderedMigrationFiles(migrationsDir);

    client = await connectWithRetry(pool);
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    locked = true;

    // All lexically ordered migrations share one session lock. The lock survives
    // transaction boundaries, so concurrent index DDL can remain standalone.
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        logger.info(`Running migration: ${file}`);
        await runMigrationFile(client, file, sql);
        logger.info(`Completed migration: ${file}`);
      } catch (error) {
        logger.error(
          { error: safeErrorDetails(error, sensitiveValues), file },
          `Failed to run migration: ${file}`,
        );
        throw error;
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error({ error: safeErrorDetails(error, sensitiveValues) }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    if (client && locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
      } catch (unlockError) {
        logger.warn(
          { error: safeErrorDetails(unlockError, sensitiveValues) },
          'Failed to release migration advisory lock',
        );
      }
    }
    client?.release();
    await pool?.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations().catch((error) => {
    logger.error({ error: safeErrorDetails(error, sensitiveValues) }, 'Migration runner failed');
    process.exitCode = 1;
  });
}
