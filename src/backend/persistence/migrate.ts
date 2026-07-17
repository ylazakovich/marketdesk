import path from 'path';
import fs from 'fs';
import { Pool, type PoolClient } from 'pg';
import dotenv from 'dotenv';
import { migrationPoolConfig } from '../config/databaseConfig.js';
import { concurrentIndexIdentity, quotedIndexIdentity } from './migrationSql.js';
import pino from 'pino';

dotenv.config();
const logger = pino();
const migrationsDir = process.env.MARKETDESK_MIGRATIONS_DIR
  ? path.resolve(process.env.MARKETDESK_MIGRATIONS_DIR)
  : path.join(process.cwd(), 'src/backend/persistence/migrations');
const MIGRATION_LOCK_KEY = 'marketdesk:migrations';
const CONNECTION_ATTEMPTS = 30;
const CONNECTION_RETRY_MS = 1_000;

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

async function runMigrations() {
  const pool = new Pool(migrationPoolConfig());
  let client: PoolClient | undefined;
  let locked = false;

  try {
    logger.info('Starting database migrations...');

    // Get all migration files
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      logger.warn('No migration files found');
      return;
    }

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
          await client.query(sql);
        }
        logger.info(`Completed migration: ${file}`);
      } catch (error) {
        logger.error({ error, file }, `Failed to run migration: ${file}`);
        throw error;
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    if (client && locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
      } catch (unlockError) {
        logger.warn({ error: unlockError }, 'Failed to release migration advisory lock');
      }
    }
    client?.release();
    await pool.end();
  }
}

runMigrations();
