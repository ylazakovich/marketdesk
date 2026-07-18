// Tests for the Group 6 repositories: AuthUserRepository and PriceHistoryRepository.
//
// The pure row<->view mappers MUST pass with no database (mirrors mappers.test).
// The DB round-trip block runs only when DATABASE_URL is set and reachable,
// otherwise it skips cleanly so `npx jest` stays green without Postgres.

import { randomUUID } from 'crypto';
import { AuthUserMapper, type AuthUserRow } from '../repositories/AuthUserRepository';
import { PriceHistoryMapper, type PriceHistoryRow } from '../repositories/PriceHistoryRepository';

describe('AuthUserMapper', () => {
  const row: AuthUserRow = {
    id: 'user-1',
    email: 'owner@example.com',
    password_hash: '$2a$10$abcdefghijklmnopqrstuv',
    workspace_id: 'ws-1',
    created_at: new Date('2026-01-01T00:00:00Z'),
  };

  it('maps snake_case columns to the AuthUserRecord shape', () => {
    const record = AuthUserMapper.toRecord(row);
    expect(record).toEqual({
      id: 'user-1',
      email: 'owner@example.com',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
      workspaceId: 'ws-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('normalizes a null workspace_id', () => {
    const record = AuthUserMapper.toRecord({ ...row, workspace_id: null });
    expect(record.workspaceId).toBeNull();
  });

  it('coerces string timestamps to Date', () => {
    const record = AuthUserMapper.toRecord({
      ...row,
      created_at: '2026-02-02T12:00:00Z',
    });
    expect(record.createdAt).toBeInstanceOf(Date);
    expect(record.createdAt.toISOString()).toBe('2026-02-02T12:00:00.000Z');
  });
});

describe('PriceHistoryMapper', () => {
  const row: PriceHistoryRow = {
    id: 'ph-1',
    listing_id: 'listing-1',
    old_price: '100.00',
    new_price: '89.50',
    changed_by: 'hermes',
    reason: 'AI suggested lower price',
    created_at: new Date('2026-03-03T00:00:00Z'),
  };

  it('maps columns, coerces DECIMAL strings to numbers and ISO-serializes the date', () => {
    const view = PriceHistoryMapper.toView(row);
    expect(view).toEqual({
      id: 'ph-1',
      listingId: 'listing-1',
      oldPrice: 100,
      newPrice: 89.5,
      changedBy: 'hermes',
      reason: 'AI suggested lower price',
      createdAt: '2026-03-03T00:00:00.000Z',
    });
  });

  it('maps a null old_price to undefined and a null reason to undefined', () => {
    const view = PriceHistoryMapper.toView({
      ...row,
      old_price: null,
      reason: null,
    });
    expect(view.oldPrice).toBeUndefined();
    expect(view.reason).toBeUndefined();
    expect(view.newPrice).toBe(89.5);
  });
});

// --- DB round-trip (skips cleanly without a reachable database) --------------

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

describeDb('AuthUserRepository / PriceHistoryRepository (integration)', () => {
  let ready = false;
  let closePool: () => Promise<void>;
  let AuthUserRepository: typeof import('../repositories/AuthUserRepository').AuthUserRepository;
  let PriceHistoryRepository: typeof import('../repositories/PriceHistoryRepository').PriceHistoryRepository;
  const email = `it-${randomUUID()}@example.com`;

  beforeAll(async () => {
    try {
      if (!hasDbUrl) throw new Error('DATABASE_URL is required for database integration tests');
      const db = await import('../../../config/database');
      const pool = db.createPool();
      closePool = db.closePool;
      await pool.query('SELECT 1');

      const tablesCheck = await pool.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'users'
        ) AND EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'price_history'
        ) AS exists`
      );
      const tablesExist = tablesCheck.rows[0]?.exists ?? false;

      if (!tablesExist) {
        if (requireDatabaseTests) {
          throw new Error('Database is missing users or price_history after migrations');
        }
        // eslint-disable-next-line no-console
        console.warn(
          '[newRepositories.integration] Database missing required tables — skipping integration tests'
        );
        ready = false;
        return;
      }

      ({ AuthUserRepository } = await import('../repositories/AuthUserRepository'));
      ({ PriceHistoryRepository } = await import('../repositories/PriceHistoryRepository'));
      ready = true;
    } catch (err) {
      if (requireDatabaseTests) throw err;
      // eslint-disable-next-line no-console
      console.warn(
        `[newRepositories.integration] Database unreachable — skipping integration tests. ${(err as Error).message}`
      );
      ready = false;
    }
  });

  afterAll(async () => {
    if (ready) {
      try {
        const db = await import('../../../config/database');
        await db.query('DELETE FROM users WHERE email = $1', [email]);
      } catch {
        // Ignore cleanup errors
      }
      await closePool();
    }
  });

  it('creates and reads back a user (workspace-less)', async () => {
    if (!ready) return;
    const repo = new AuthUserRepository();
    const created = await repo.create({
      email,
      passwordHash: '$2a$10$roundtriphashroundtriphashab',
      workspaceId: null,
    });
    expect(created.email).toBe(email);

    const byEmail = await repo.findByEmail(email.toUpperCase());
    expect(byEmail?.id).toBe(created.id);
    const byId = await repo.findById(created.id);
    expect(byId?.email).toBe(email);
  });

  it('returns an empty price history for an unknown listing', async () => {
    if (!ready) return;
    const repo = new PriceHistoryRepository();
    const history = await repo.findByListing(randomUUID());
    expect(history).toEqual([]);
  });
});
