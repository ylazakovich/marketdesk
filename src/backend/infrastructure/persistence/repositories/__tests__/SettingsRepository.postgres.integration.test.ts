import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import { SettingsRepository } from '../SettingsRepository';

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDatabase = hasDatabaseUrl || requireDatabaseTests ? describe : describe.skip;

describeDatabase('SettingsRepository on already-migrated PostgreSQL (integration)', () => {
  let pool: Pool;
  let ready = false;
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    try {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required for database integration tests');
      }
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query('SELECT 1');
      await pool.query(
        `INSERT INTO workspaces (id, name, currency, timezone, language)
         VALUES ($1, 'Settings IT A', 'PLN', 'Europe/Warsaw', 'en'),
                ($2, 'Settings IT B', 'EUR', 'Europe/Berlin', 'en')`,
        [workspaceA, workspaceB]
      );
      await pool.query(
        `INSERT INTO users (id, email, password_hash, workspace_id)
         VALUES ($1, $2, 'integration-test-hash', $3),
                ($4, $5, 'integration-test-hash', $6)`,
        [
          userA,
          `settings-${userA}@example.invalid`,
          workspaceA,
          userB,
          `settings-${userB}@example.invalid`,
          workspaceB,
        ]
      );
      ready = true;
    } catch (error) {
      if (requireDatabaseTests) throw error;
      console.warn('[settings.repository.integration] skipped: PostgreSQL unavailable');
    }
  });

  afterAll(async () => {
    if (pool) {
      if (ready) {
        await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [
          [workspaceA, workspaceB],
        ]);
      }
      await pool.end();
    }
  });

  it('persists atomic settings, enforces tenant ownership/cascade, and scopes API-key counts', async () => {
    if (!ready) return;
    const first = new SettingsRepository(pool);

    await Promise.all([
      first.updateUserPreferences(workspaceA, userA, { themeMode: 'dark' }),
      first.updateUserPreferences(workspaceA, userA, { density: 'compact' }),
    ]);
    await Promise.all([
      first.updateNotificationPreferences(workspaceA, userA, {
        events: { sync_error: { email: false } },
      }),
      first.updateNotificationPreferences(workspaceA, userA, {
        events: { sync_error: { telegram: true } },
      }),
    ]);

    const second = new SettingsRepository(pool);
    await expect(second.getUserPreferences(workspaceA, userA)).resolves.toMatchObject({
      themeMode: 'dark',
      density: 'compact',
    });
    await expect(second.getNotificationPreferences(workspaceA, userA)).resolves.toMatchObject({
      events: { sync_error: { email: false, inApp: true, telegram: true } },
    });

    await expect(
      second.updateUserPreferences(workspaceA, userB, { themeMode: 'light' })
    ).rejects.toMatchObject({ code: '23503' });

    await pool.query(
      `INSERT INTO api_keys (workspace_id, name, key_hash, revoked)
       VALUES ($1, 'active-a', $2, FALSE), ($1, 'revoked-a', $3, TRUE),
              ($4, 'active-b', $5, FALSE)`,
      [
        workspaceA,
        `hash-${randomUUID()}`,
        `hash-${randomUUID()}`,
        workspaceB,
        `hash-${randomUUID()}`,
      ]
    );
    await expect(second.getApiKeySummary(workspaceA)).resolves.toEqual({
      total: 2,
      active: 1,
      revoked: 1,
    });
    await expect(second.getApiKeySummary(workspaceB)).resolves.toEqual({
      total: 1,
      active: 1,
      revoked: 0,
    });

    await pool.query('DELETE FROM users WHERE id = $1', [userA]);
    const cascade = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM user_preferences WHERE user_id = $1)::int AS user_count,
         (SELECT COUNT(*) FROM notification_preferences WHERE user_id = $1)::int AS notification_count`,
      [userA]
    );
    expect(cascade.rows[0]).toEqual({ user_count: 0, notification_count: 0 });
  });

  it('safely reruns migration 029 and verifies real catalog constraints without a fresh reset', async () => {
    if (!ready) return;
    const migration = await readFile(
      path.resolve(
        process.cwd(),
        'src/backend/persistence/migrations/029_persistent_settings_contracts.sql'
      ),
      'utf8'
    );
    await pool.query('BEGIN');
    try {
      await pool.query(migration);
      const catalog = await pool.query(
        `SELECT conname
           FROM pg_constraint
          WHERE conrelid IN (
            'workspaces'::regclass,
            'user_preferences'::regclass,
            'notification_preferences'::regclass
          )
            AND conname IN (
              'workspaces_language_valid',
              'user_preferences_user_workspace_fkey',
              'notification_preferences_user_workspace_fkey'
            )`
      );
      expect(catalog.rows.map((row) => row.conname).sort()).toEqual([
        'notification_preferences_user_workspace_fkey',
        'user_preferences_user_workspace_fkey',
        'workspaces_language_valid',
      ]);
    } finally {
      await pool.query('ROLLBACK');
    }
  });
});
