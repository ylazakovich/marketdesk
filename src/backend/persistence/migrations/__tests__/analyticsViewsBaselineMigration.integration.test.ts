import fs from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

function readMigration(name = '038_seed_views_from_listings.sql'): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), 'src/backend/persistence/migrations', name),
    'utf8',
  );
}

describeDb('analytics views baseline migration (PostgreSQL integration)', () => {
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
        CREATE TEMP TABLE products (
          id uuid PRIMARY KEY,
          workspace_id uuid NOT NULL
        );
        CREATE TEMP TABLE listings (
          id uuid PRIMARY KEY,
          product_id uuid NOT NULL,
          marketplace_id uuid NOT NULL,
          views integer,
          published_at timestamp,
          last_sync_at timestamp,
          created_at timestamp,
          updated_at timestamp
        );
        CREATE TEMP TABLE analytics_events (
          id bigserial PRIMARY KEY,
          workspace_id uuid NOT NULL,
          listing_id uuid,
          marketplace_id uuid,
          event_type text NOT NULL,
          quantity integer NOT NULL,
          amount numeric,
          cost_at_sale numeric,
          currency text,
          occurred_at timestamp NOT NULL,
          created_at timestamp
        );
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

  it('seeds only the missing positive view gap and is replay-safe', async () => {
    if (!ready) return;
    const workspaceId = '00000000-0000-0000-0000-000000000001';
    const marketplaceId = '00000000-0000-0000-0000-000000000002';
    const productId = '00000000-0000-0000-0000-000000000003';
    const listingIds = Array.from({ length: 6 }, (_, index) =>
      `00000000-0000-0000-0000-${String(index + 10).padStart(12, '0')}`,
    );

    await client.query('INSERT INTO products (id, workspace_id) VALUES ($1, $2)', [productId, workspaceId]);
    await client.query(
      `INSERT INTO listings
        (id, product_id, marketplace_id, views, published_at, last_sync_at, created_at, updated_at)
       SELECT id, $1, $2, views, published_at, last_sync_at, created_at, updated_at
       FROM json_to_recordset($3::json) AS x(
         id uuid, views integer, published_at timestamp, last_sync_at timestamp,
         created_at timestamp, updated_at timestamp
       )`,
      [productId, marketplaceId, JSON.stringify([
        { id: listingIds[0], views: 10, published_at: '2026-07-01T00:00:00Z', last_sync_at: '2026-07-20T12:00:00Z', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-19T00:00:00Z' },
        { id: listingIds[1], views: 10, published_at: '2026-07-02T00:00:00Z', last_sync_at: null, created_at: '2026-07-02T00:00:00Z', updated_at: '2026-07-19T11:00:00Z' },
        { id: listingIds[2], views: 10, published_at: '2026-07-03T00:00:00Z', last_sync_at: null, created_at: '2026-07-03T00:00:00Z', updated_at: '2026-07-18T00:00:00Z' },
        { id: listingIds[3], views: 0, published_at: null, last_sync_at: null, created_at: '2026-07-04T00:00:00Z', updated_at: '2026-07-18T00:00:00Z' },
        { id: listingIds[4], views: null, published_at: null, last_sync_at: null, created_at: '2026-07-05T00:00:00Z', updated_at: '2026-07-18T00:00:00Z' },
        { id: listingIds[5], views: 5, published_at: '2026-07-06T00:00:00Z', last_sync_at: null, created_at: '2026-07-06T00:00:00Z', updated_at: '2026-07-18T00:00:00Z' },
      ])],
    );
    await client.query(
      `INSERT INTO analytics_events
        (workspace_id, listing_id, marketplace_id, event_type, quantity, occurred_at)
       VALUES ($1, $2, $3, 'view', 3, NOW()),
              ($1, $4, $3, 'view', 10, NOW()),
              ($1, $5, $3, 'view', 7, NOW())`,
      [workspaceId, listingIds[1], marketplaceId, listingIds[2], listingIds[5]],
    );

    const migration = readMigration();
    await client.query(migration);
    await client.query(migration);

    const totals = await client.query<{ listing_id: string; total: number; events: number }>(`
      SELECT listing_id::text, SUM(quantity)::integer AS total, COUNT(*)::integer AS events
      FROM analytics_events
      WHERE event_type = 'view'
      GROUP BY listing_id
      ORDER BY listing_id
    `);
    expect(totals.rows).toEqual([
      { listing_id: listingIds[0], total: 10, events: 1 },
      { listing_id: listingIds[1], total: 10, events: 2 },
      { listing_id: listingIds[2], total: 10, events: 1 },
      { listing_id: listingIds[5], total: 7, events: 1 },
    ]);

    const baselines = await client.query<{ listing_id: string; quantity: number; occurred_at: string }>(`
      SELECT
        listing_id::text,
        quantity,
        to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS occurred_at
      FROM analytics_events
      WHERE (listing_id = $1 AND quantity = 10) OR (listing_id = $2 AND quantity = 7)
      ORDER BY listing_id
    `, [listingIds[0], listingIds[1]]);
    expect(baselines.rows.map((row) => ({
      listingId: row.listing_id,
      quantity: row.quantity,
      occurredAt: row.occurred_at,
    }))).toEqual([
      { listingId: listingIds[0], quantity: 10, occurredAt: '2026-07-20T12:00:00.000Z' },
      { listingId: listingIds[1], quantity: 7, occurredAt: '2026-07-19T11:00:00.000Z' },
    ]);

    const fabricated = await client.query<{ count: number }>(`
      SELECT COUNT(*)::integer AS count
      FROM analytics_events
      WHERE event_type IN ('sale', 'message')
    `);
    expect(fabricated.rows[0]?.count).toBe(0);
  });

  it('repairs mixed and negative signed histories after migration 038 and is replay-safe', async () => {
    if (!ready) return;
    await client.query('TRUNCATE analytics_events, listings, products RESTART IDENTITY');

    const workspaceId = '10000000-0000-0000-0000-000000000001';
    const marketplaceId = '10000000-0000-0000-0000-000000000002';
    const productId = '10000000-0000-0000-0000-000000000003';
    const listingIds = Array.from({ length: 6 }, (_, index) =>
      `10000000-0000-0000-0000-${String(index + 10).padStart(12, '0')}`,
    );

    await client.query('INSERT INTO products (id, workspace_id) VALUES ($1, $2)', [productId, workspaceId]);
    await client.query(
      `INSERT INTO listings
        (id, product_id, marketplace_id, views, published_at, last_sync_at, created_at, updated_at)
       SELECT id, $1, $2, views, NULL, '2026-07-21T12:00:00Z', '2026-07-01T00:00:00Z', '2026-07-21T11:00:00Z'
       FROM json_to_recordset($3::json) AS x(id uuid, views integer)`,
      [productId, marketplaceId, JSON.stringify([
        { id: listingIds[0], views: 10 },
        { id: listingIds[1], views: 10 },
        { id: listingIds[2], views: 0 },
        { id: listingIds[3], views: null },
        { id: listingIds[4], views: 10 },
        { id: listingIds[5], views: 2147483647 },
      ])],
    );
    await client.query(
      `INSERT INTO analytics_events
        (workspace_id, listing_id, marketplace_id, event_type, quantity, occurred_at)
       VALUES ($1, $2, $3, 'view', 7, NOW()),
              ($1, $2, $3, 'view', -3, NOW()),
              ($1, $4, $3, 'view', -4, NOW()),
              ($1, $5, $3, 'view', -2, NOW()),
              ($1, $6, $3, 'view', -2, NOW()),
              ($1, $7, $3, 'view', 10, NOW()),
              ($1, $7, $3, 'view', -3, NOW()),
              ($1, $8, $3, 'view', -2147483648, NOW())`,
      [workspaceId, listingIds[0], marketplaceId, listingIds[1], listingIds[2], listingIds[3], listingIds[4], listingIds[5]],
    );

    await client.query(readMigration('038_seed_views_from_listings.sql'));
    await client.query("UPDATE listings SET last_sync_at = '2026-07-22T12:00:00Z'");
    const reconcile = readMigration('039_reconcile_signed_view_totals.sql');
    await client.query(reconcile);
    await client.query(reconcile);

    const totals = await client.query<{ listing_id: string; total: number; events: number }>(`
      SELECT listing_id::text, SUM(quantity)::integer AS total, COUNT(*)::integer AS events
      FROM analytics_events
      WHERE event_type = 'view'
      GROUP BY listing_id
      ORDER BY listing_id
    `);
    expect(totals.rows).toEqual([
      { listing_id: listingIds[0], total: 10, events: 4 },
      { listing_id: listingIds[1], total: 10, events: 3 },
      { listing_id: listingIds[2], total: 0, events: 2 },
      { listing_id: listingIds[3], total: 0, events: 2 },
      { listing_id: listingIds[4], total: 10, events: 3 },
      { listing_id: listingIds[5], total: 2147483647, events: 4 },
    ]);

    const corrections = await client.query<{ listing_id: string; quantity: number }>(`
      SELECT listing_id::text, quantity
      FROM analytics_events
      WHERE occurred_at = '2026-07-22T12:00:00Z'
      ORDER BY listing_id, quantity
    `);
    expect(corrections.rows).toEqual([
      { listing_id: listingIds[0], quantity: 3 },
      { listing_id: listingIds[1], quantity: 4 },
      { listing_id: listingIds[2], quantity: 2 },
      { listing_id: listingIds[3], quantity: 2 },
      { listing_id: listingIds[4], quantity: 3 },
      { listing_id: listingIds[5], quantity: 1 },
      { listing_id: listingIds[5], quantity: 2147483647 },
    ]);

    const fabricated = await client.query<{ count: number }>(`
      SELECT COUNT(*)::integer AS count
      FROM analytics_events
      WHERE event_type IN ('sale', 'message') OR quantity = 0
    `);
    expect(fabricated.rows[0]?.count).toBe(0);
  });
});
