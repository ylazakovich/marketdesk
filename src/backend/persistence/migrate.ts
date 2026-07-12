import path from 'path';
import fs from 'fs';
import { createPool, closePool } from '../config/database.js';
import pino from 'pino';

const logger = pino();
const migrationsDir = path.join(process.cwd(), 'src/backend/persistence/migrations');

async function runMigrations() {
  const pool = createPool();

  try {
    logger.info('Starting database migrations...');

    // Get all migration files
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      logger.warn('No migration files found');
      return;
    }

    // Run each migration
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        logger.info(`Running migration: ${file}`);
        await pool.query(sql);
        logger.info(`Completed migration: ${file}`);
      } catch (error) {
        logger.error({ error, file }, `Failed to run migration: ${file}`);
        throw error;
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  } finally {
    await closePool();
  }
}

runMigrations();
