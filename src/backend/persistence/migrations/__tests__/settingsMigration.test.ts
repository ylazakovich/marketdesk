import fs from 'node:fs';
import path from 'node:path';

describe('persistent settings migration', () => {
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/backend/persistence/migrations/029_persistent_settings_contracts.sql'
    ),
    'utf8'
  );
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'src/backend/persistence/schema.sql'),
    'utf8'
  );

  it('backfills and constrains workspace language idempotently', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS language');
    expect(migration).toContain("UPDATE workspaces SET language = 'en'");
    expect(migration).toContain('ALTER COLUMN language SET NOT NULL');
    expect(migration).toContain('workspaces_language_valid');
    expect(migration).toContain("conrelid = 'workspaces'::regclass");
    expect(schema).toContain("language VARCHAR(10) NOT NULL DEFAULT 'en'");
  });

  it('uses normalized, tenant-and-user-scoped preference tables without JSONB', () => {
    for (const sql of [migration, schema]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS user_preferences');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS notification_preferences');
      expect(sql).toContain(
        'FOREIGN KEY (workspace_id, user_id) REFERENCES users(workspace_id, id)'
      );
      const userTable = sql.match(
        /CREATE TABLE IF NOT EXISTS user_preferences \([\s\S]*?\n\);/
      )?.[0];
      const notificationTable = sql.match(
        /CREATE TABLE IF NOT EXISTS notification_preferences \([\s\S]*?\n\);/
      )?.[0];
      expect(userTable).toBeDefined();
      expect(notificationTable).toBeDefined();
      expect(`${userTable}${notificationTable}`).not.toMatch(/JSONB/i);
    }
  });
});
