import type { Pool } from 'pg';
import {
  MarketplaceAccountMapper,
  MarketplaceAccountRepository,
  type MarketplaceAccountRow,
} from '../MarketplaceAccountRepository';

describe('MarketplaceAccountRepository', () => {
  const row: MarketplaceAccountRow = {
    id: 'account-1',
    marketplace_id: 'marketplace-1',
    handle: 'OLX account',
    credentials: { version: 1, ciphertext: 'encrypted' },
    status: 'connected',
    scopes: ['basic'],
    revision: 7,
    created_at: '2026-07-14T12:00:00.000Z',
    updated_at: '2026-07-14T12:01:00.000Z',
  };

  it('maps persistence rows without changing the encrypted credential envelope', () => {
    const account = MarketplaceAccountMapper.toRecord(row);
    expect(account.marketplaceId).toBe('marketplace-1');
    expect(account.credentials).toEqual({ version: 1, ciphertext: 'encrypted' });
    expect(account.revision).toBe(7);
    expect(account.createdAt).toEqual(new Date('2026-07-14T12:00:00.000Z'));
  });

  it('upserts by marketplace_id so a marketplace has one active OAuth account', async () => {
    const query = jest.fn(async () => ({ rows: [row], rowCount: 1 }));
    const repo = new MarketplaceAccountRepository({ query } as unknown as Pool);

    await repo.upsert({
      id: 'account-1',
      marketplaceId: 'marketplace-1',
      handle: 'OLX account',
      credentials: { version: 1, ciphertext: 'encrypted' },
      status: 'connected',
      scopes: ['basic'],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('ON CONFLICT (marketplace_id)');
    expect(sql).toContain('revision = marketplace_accounts.revision + 1');
    expect(query.mock.calls[0][1]).toEqual([
      'account-1',
      'marketplace-1',
      'OLX account',
      JSON.stringify({ version: 1, ciphertext: 'encrypted' }),
      'connected',
      ['basic'],
    ]);
  });

  it('locks the account row on the transaction client before fenced writes', async () => {
    const poolQuery = jest.fn(async () => {
      throw new Error('shared pool must not be used for a transactional fence');
    });
    const clientQuery = jest.fn(async () => ({ rows: [row], rowCount: 1 }));
    const repo = new MarketplaceAccountRepository(
      { query: poolQuery } as unknown as Pool,
      { query: clientQuery } as never,
    );

    const account = await repo.findByMarketplaceIdForUpdate('marketplace-1');

    expect(account?.revision).toBe(7);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(String(clientQuery.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(clientQuery.mock.calls[0][1]).toEqual(['marketplace-1']);
  });

  it('uses an integer revision for refresh CAS instead of a lossy JavaScript timestamp', async () => {
    const microsecondRow: MarketplaceAccountRow = {
      ...row,
      updated_at: '2026-07-14T12:01:00.071888Z',
    };
    const query = jest.fn(async () => ({ rows: [microsecondRow], rowCount: 1 }));
    const repo = new MarketplaceAccountRepository({ query } as unknown as Pool);
    const expectedRevision = 7;

    await repo.updateConnectedIfUnchanged(
      {
        id: 'account-1',
        marketplaceId: 'marketplace-1',
        handle: 'OLX account',
        credentials: { version: 1, ciphertext: 'refreshed' },
        status: 'connected',
        scopes: ['basic'],
      },
      expectedRevision
    );

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("AND status = 'connected'");
    expect(sql).toContain('AND revision = $7');
    expect(sql).toContain('revision = revision + 1');
    expect(sql).not.toContain('AND updated_at = $7');
    expect(query.mock.calls[0][1]?.[6]).toBe(expectedRevision);
  });
});
