import type { Pool } from 'pg';
import { WorkspaceRepository } from '../WorkspaceRepository';

function recordingPool() {
  const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
  return { query, pool: { query } as unknown as Pool };
}

describe('WorkspaceRepository partial update SQL contracts (mocked; no PostgreSQL execution)', () => {
  it('profile update cannot overwrite Hermes fields', async () => {
    const { query, pool } = recordingPool();
    const repository = new WorkspaceRepository(pool);

    await repository.updateProfile('workspace-a', { name: 'New name', language: 'pl' });

    const [sql, values] = query.mock.calls[0]!;
    const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
    expect(setClause).toContain('name = COALESCE($2, name)');
    expect(setClause).toContain('language = COALESCE($5, language)');
    expect(setClause).not.toMatch(/autonomy_level|guardrails/);
    expect(values).toEqual(['workspace-a', 'New name', null, null, 'pl']);
  });

  it('Hermes update atomically merges only the supplied guardrail keys', async () => {
    const { query, pool } = recordingPool();
    const repository = new WorkspaceRepository(pool);

    await repository.updateHermes('workspace-a', {
      guardrails: { autoRelist: true },
    });

    const [sql, values] = query.mock.calls[0]!;
    const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
    expect(setClause).toContain("guardrails = COALESCE(guardrails, '{}'::jsonb) ||");
    expect(setClause).not.toMatch(/name\s*=|currency\s*=|timezone\s*=|language\s*=/);
    expect(values).toEqual(['workspace-a', null, JSON.stringify({ autoRelist: true })]);
  });

  it('legacy partial update preserves every unspecified profile and autonomy field in SQL', async () => {
    const { query, pool } = recordingPool();
    const repository = new WorkspaceRepository(pool);

    await repository.updatePartial('workspace-a', { name: 'Only name' });

    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('name = COALESCE($2, name)');
    expect(sql).toContain('currency = COALESCE($3, currency)');
    expect(sql).toContain('autonomy_level = COALESCE($6, autonomy_level)');
    expect(sql).toContain("COALESCE($7::jsonb, '{}'::jsonb)");
    expect(values).toEqual(['workspace-a', 'Only name', null, null, null, null, null]);
  });
});
