import fs from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

function readMigration(name: string): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), 'src/backend/persistence/migrations', name),
    'utf8',
  );
}

describeDb('standalone delist migration replay (PostgreSQL integration)', () => {
  let ready = false;
  let pool: Pool;
  let client: PoolClient;
  let closePool: () => Promise<void>;

  beforeAll(async () => {
    try {
      if (!hasDbUrl) throw new Error('DATABASE_URL is required for database integration tests');
      const db = await import('../../../config/database');
      pool = await db.getPool();
      closePool = db.closePool;
      client = await pool.connect();
      await client.query(`
        CREATE TEMP TABLE category_correction_operations (
          id uuid PRIMARY KEY,
          kind text NOT NULL,
          recommendation_event_id uuid NOT NULL
        )
      `);
      ready = true;
    } catch (error) {
      if (requireDatabaseTests) throw error;
      ready = false;
    }
  });

  afterAll(async () => {
    client?.release();
    await closePool?.();
  });

  it('runs the add-and-validate pair twice and leaves one valid constraint', async () => {
    if (!ready) return;
    const addConstraint = readMigration('031_standalone_listing_delist_operations.sql');
    const validateConstraint = readMigration('032_validate_standalone_listing_delist_operations.sql');

    await client.query(addConstraint);
    await client.query(validateConstraint);
    await client.query(addConstraint);
    await client.query(validateConstraint);

    const result = await client.query<{ count: string; valid: boolean }>(`
      SELECT COUNT(*)::text AS count, BOOL_AND(convalidated) AS valid
        FROM pg_constraint
       WHERE conrelid = 'category_correction_operations'::regclass
         AND conname = 'category_correction_operation_recommendation_check'
    `);
    expect(result.rows[0]).toEqual({ count: '1', valid: true });
  });

  it('fails closed when validation runs without the expected constraint', async () => {
    if (!ready) return;
    const validateConstraint = readMigration('032_validate_standalone_listing_delist_operations.sql');
    await client.query(`
      ALTER TABLE category_correction_operations
        DROP CONSTRAINT IF EXISTS category_correction_operation_recommendation_check
    `);

    await expect(client.query(validateConstraint)).rejects.toThrow(
      'Missing constraint category_correction_operation_recommendation_check',
    );
  });
});
