import type { Pool } from 'pg';
import { OlxPublicationQuotaRepository } from '../OlxPublicationQuotaRepository';
import { OlxPublicationQuota } from '../../../../domain/entities/OlxPublicationQuota';

const quotaRow = (consumed: number) => ({
  id: 'quota-1',
  workspace_id: 'ws-1',
  marketplace_id: 'mp-1',
  marketplace_account_id: 'account-1',
  subcategory_id: '2000',
  cycle_started_at: new Date('2026-07-01T00:00:00.000Z'),
  cycle_ends_at: new Date('2026-08-01T00:00:00.000Z'),
  publication_limit: 1,
  consumed,
  source: 'operator',
  confidence: 'verified',
  verified_at: new Date('2026-07-14T00:00:00.000Z'),
  stale_at: new Date('2026-07-20T00:00:00.000Z'),
  created_at: new Date('2026-07-01T00:00:00.000Z'),
  updated_at: new Date('2026-07-15T00:00:00.000Z'),
});

describe('OlxPublicationQuotaRepository', () => {
  it('locks the operation and quota row before atomically consuming a free unit', async () => {
    const statements: string[] = [];
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      statements.push(sql);
      if (sql.includes('FROM olx_publication_operations')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM olx_publication_quotas') && sql.includes('FOR UPDATE')) {
        return { rows: [quotaRow(0)], rowCount: 1 };
      }
      if (sql.includes('UPDATE olx_publication_quotas')) {
        return { rows: [quotaRow(1)], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const release = jest.fn();
    const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
    const repository = new OlxPublicationQuotaRepository(pool);

    const result = await repository.authorize({
      operationId: 'operation-1',
      workspaceId: 'ws-1',
      marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1',
      subcategoryId: '2000',
      at: new Date('2026-07-15T12:00:00.000Z'),
      listingId: 'listing-1',
      mode: 'publish',
      overrideConfirmed: true,
      overrideReason: 'Operator pre-confirmed paid risk, but a free unit is available',
      actorId: 'user-1',
    });

    const operationInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO olx_publication_operations'),
    );

    expect(result).toMatchObject({
      decision: 'allow',
      status: 'available',
      consumedUnit: true,
      quota: { consumed: 1, remaining: 0 },
    });
    expect(operationInsert?.[1]?.[12]).toBeNull();
    expect(statements.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(statements.some((sql) => sql.includes('FOR UPDATE'))).toBe(true);
    expect(statements.some((sql) => sql.includes('SET consumed = consumed + 1'))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalled();
  });

  it('uses a monotonic upsert so an in-cycle operator update cannot restore consumed units', async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new OlxPublicationQuotaRepository({ query } as unknown as Pool);
    const quota = OlxPublicationQuota.create({
      id: 'quota-1',
      workspaceId: 'ws-1',
      marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1',
      subcategoryId: '2000',
      cycleStartedAt: new Date('2026-07-01T00:00:00.000Z'),
      cycleEndsAt: new Date('2026-08-01T00:00:00.000Z'),
      publicationLimit: 1,
      consumed: 0,
      source: 'operator',
      confidence: 'verified',
      verifiedAt: new Date('2026-07-14T00:00:00.000Z'),
      staleAt: new Date('2026-07-20T00:00:00.000Z'),
    });
    if (quota.isErr()) throw quota.error;

    await repository.save(quota.value);

    expect(String(query.mock.calls[0][0])).toContain(
      'GREATEST(olx_publication_quotas.consumed, EXCLUDED.consumed)',
    );
  });

  it('bounds account quota history in SQL', async () => {
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));
    const repository = new OlxPublicationQuotaRepository({ query } as unknown as Pool);

    await repository.findByAccount({
      workspaceId: 'ws-1', marketplaceId: 'mp-1', marketplaceAccountId: 'account-1', limit: 100,
    });

    expect(String(query.mock.calls[0][0])).toContain('LIMIT $4');
    expect(query.mock.calls[0][1]).toEqual(['ws-1', 'mp-1', 'account-1', 100]);
  });

  it('persists a block without consuming quota', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM olx_publication_operations')) return { rows: [], rowCount: 0 };
      if (sql.includes('FOR UPDATE')) return { rows: [quotaRow(1)], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pool = { connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;

    const result = await new OlxPublicationQuotaRepository(pool).authorize({
      operationId: 'operation-block', workspaceId: 'ws-1', marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1', subcategoryId: '2000',
      at: new Date('2026-07-15T12:00:00.000Z'), listingId: 'listing-1', mode: 'publish',
      overrideConfirmed: false,
    });

    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO olx_publication_operations'));
    expect(result).toMatchObject({ decision: 'block', consumedUnit: false, replayed: false });
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE olx_publication_quotas'))).toBe(false);
    expect(insert?.[1]?.[8]).toBe('block');
    expect(insert?.[1]?.[11]).toBe(false);
  });

  it('persists an explicit override and consumes the associated quota row', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM olx_publication_operations')) return { rows: [], rowCount: 0 };
      if (sql.includes('FOR UPDATE')) return { rows: [quotaRow(1)], rowCount: 1 };
      if (sql.includes('UPDATE olx_publication_quotas')) return { rows: [quotaRow(2)], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pool = { connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;

    const result = await new OlxPublicationQuotaRepository(pool).authorize({
      operationId: 'operation-override', workspaceId: 'ws-1', marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1', subcategoryId: '2000',
      at: new Date('2026-07-15T12:00:00.000Z'), listingId: 'listing-1', mode: 'publish',
      overrideConfirmed: true, overrideReason: 'Operator accepts paid publication', actorId: 'user-1',
    });

    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO olx_publication_operations'));
    expect(result).toMatchObject({ decision: 'override', consumedUnit: true, replayed: false });
    expect(insert?.[1]?.[8]).toBe('override');
    expect(insert?.[1]?.[12]).toBe('Operator accepts paid publication');
  });

  it('short-circuits a replay before locking or consuming quota', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM olx_publication_operations')) {
        return { rows: [{
          operation_id: 'operation-replay', decision: 'block', quota_status: 'exhausted',
          reason: 'quota_exhausted', consumed_unit: false, quota_id: null,
        }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = { connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;

    const result = await new OlxPublicationQuotaRepository(pool).authorize({
      operationId: 'operation-replay', workspaceId: 'ws-1', marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1', subcategoryId: '2000',
      at: new Date('2026-07-15T12:00:00.000Z'), listingId: 'listing-1', mode: 'publish',
      overrideConfirmed: false,
    });

    expect(result).toMatchObject({ decision: 'block', consumedUnit: false, replayed: true });
    expect(query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO olx_publication_operations'))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
});
