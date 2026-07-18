import type { Pool } from 'pg';
import { InMemorySettingsRepository } from '../InMemorySettingsRepository';
import { SettingsRepository } from '../SettingsRepository';

function poolWith(queryImpl: (text: string, values?: unknown[]) => unknown): Pool {
  return { query: jest.fn(queryImpl) } as unknown as Pool;
}

describe('SettingsRepository SQL contracts (mocked; no PostgreSQL execution)', () => {
  it('always scopes preference reads by workspace and user', async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new SettingsRepository(poolWith(query));

    const result = await repository.getUserPreferences('workspace-a', 'user-a');

    expect(result).toMatchObject({ workspaceId: 'workspace-a', userId: 'user-a', revision: 0 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE workspace_id = $1 AND user_id = $2'),
      ['workspace-a', 'user-a']
    );
  });

  it('patches user preferences in one UPSERT without read-derived values', async () => {
    const query = jest.fn(async () => ({
      rows: [
        {
          workspace_id: 'workspace-a',
          user_id: 'user-a',
          theme_mode: 'dark',
          density: 'compact',
          revision: '4',
          updated_at: '2026-07-18T00:00:00.000Z',
        },
      ],
      rowCount: 1,
    }));
    const repository = new SettingsRepository(poolWith(query));

    const result = await repository.updateUserPreferences('workspace-a', 'user-a', {
      themeMode: 'dark',
    });

    expect(result).toMatchObject({ themeMode: 'dark', density: 'compact', revision: 4 });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('theme_mode = COALESCE($3, user_preferences.theme_mode)');
    expect(sql).toContain('density = COALESCE($4, user_preferences.density)');
    expect(sql).not.toMatch(/SELECT[\s\S]*FROM user_preferences/i);
    expect(values).toEqual(['workspace-a', 'user-a', 'dark', null]);
  });

  it('writes a multi-event notification patch with one UPSERT and SQL-side channel preservation', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 2 });
    const repository = new SettingsRepository(poolWith(query));

    const result = await repository.updateNotificationPreferences('workspace-a', 'user-a', {
      events: {
        new_sale: { telegram: true },
        sync_error: { email: false },
      },
    });

    expect(result.events.new_sale).toEqual({ email: true, inApp: true, telegram: false });
    expect(query).toHaveBeenCalledTimes(1);
    const [writeSql, values] = query.mock.calls[0]!;
    expect(writeSql).toContain('WITH patch');
    expect(writeSql).toContain('ON CONFLICT (workspace_id, user_id, event_key) DO UPDATE');
    expect(writeSql).toContain('notification_preferences.email_enabled');
    expect(writeSql).toContain('notification_preferences.telegram_enabled');
    expect(writeSql).toContain('RETURNING workspace_id');
    expect(values).toEqual([
      'workspace-a',
      'user-a',
      'new_sale',
      null,
      null,
      true,
      'sync_error',
      false,
      null,
      null,
    ]);
  });

  it('rejects an empty notification event patch before issuing SQL', async () => {
    const query = jest.fn();
    const repository = new SettingsRepository(poolWith(query));

    await expect(
      repository.updateNotificationPreferences('workspace-a', 'user-a', { events: {} })
    ).rejects.toThrow('at least one event');
    expect(query).not.toHaveBeenCalled();
  });

  it('summarizes API keys by tenant without selecting hashes', async () => {
    const query = jest.fn(async () => ({
      rows: [{ total: '3', active: '2', revoked: '1' }],
      rowCount: 1,
    }));
    const repository = new SettingsRepository(poolWith(query));

    await expect(repository.getApiKeySummary('workspace-a')).resolves.toEqual({
      total: 3,
      active: 2,
      revoked: 1,
    });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('WHERE workspace_id = $1');
    expect(sql).not.toMatch(/key_hash|token|secret/i);
    expect(values).toEqual(['workspace-a']);
  });
});

describe('InMemorySettingsRepository atomic semantics', () => {
  it('preserves concurrent independent preference patches', async () => {
    const repository = new InMemorySettingsRepository();

    await Promise.all([
      repository.updateUserPreferences('workspace-a', 'user-a', { themeMode: 'dark' }),
      repository.updateUserPreferences('workspace-a', 'user-a', { density: 'compact' }),
    ]);

    await expect(repository.getUserPreferences('workspace-a', 'user-a')).resolves.toMatchObject({
      themeMode: 'dark',
      density: 'compact',
      revision: 2,
    });
  });
});
