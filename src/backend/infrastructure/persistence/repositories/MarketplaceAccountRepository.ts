import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type {
  MarketplaceAccountRecord,
  MarketplaceAccountRepository as MarketplaceAccountRepositoryPort,
} from '../../../application/services/MarketplaceOAuthService';
import type { MarketplaceAccountStatus } from '../../../../shared/types';

export interface MarketplaceAccountRow {
  id: string;
  marketplace_id: string;
  handle: string;
  credentials: Record<string, unknown>;
  status: string;
  scopes: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const ACCOUNT_SELECT = `
  SELECT id, marketplace_id, handle, credentials, status, scopes, created_at, updated_at
  FROM marketplace_accounts
`;

export const MarketplaceAccountMapper = {
  toRecord(row: MarketplaceAccountRow): MarketplaceAccountRecord {
    return {
      id: row.id,
      marketplaceId: row.marketplace_id,
      handle: row.handle,
      credentials: row.credentials,
      status: row.status as MarketplaceAccountStatus,
      scopes: row.scopes ?? [],
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    };
  },
};

export class MarketplaceAccountRepository implements MarketplaceAccountRepositoryPort {
  private readonly queryClient?: Pool | PoolClient;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client ?? pool;
  }

  async findByMarketplaceId(marketplaceId: string): Promise<MarketplaceAccountRecord | null> {
    const { rows } = await query<MarketplaceAccountRow>(
      `${ACCOUNT_SELECT} WHERE marketplace_id = $1 LIMIT 1`,
      [marketplaceId],
      this.queryClient
    );
    return rows[0] ? MarketplaceAccountMapper.toRecord(rows[0]) : null;
  }

  async upsert(
    account: Omit<MarketplaceAccountRecord, 'createdAt' | 'updatedAt'>
  ): Promise<MarketplaceAccountRecord> {
    const { rows } = await query<MarketplaceAccountRow>(
      `INSERT INTO marketplace_accounts
         (id, marketplace_id, handle, credentials, status, scopes)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (marketplace_id) DO UPDATE SET
         handle = EXCLUDED.handle,
         credentials = EXCLUDED.credentials,
         status = EXCLUDED.status,
         scopes = EXCLUDED.scopes,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, marketplace_id, handle, credentials, status, scopes, created_at, updated_at`,
      [
        account.id,
        account.marketplaceId,
        account.handle,
        JSON.stringify(account.credentials),
        account.status,
        account.scopes,
      ],
      this.queryClient
    );
    const row = rows[0];
    if (!row) throw new Error('Marketplace account upsert returned no row');
    return MarketplaceAccountMapper.toRecord(row);
  }

  async updateConnectedIfUnchanged(
    account: Omit<MarketplaceAccountRecord, 'createdAt' | 'updatedAt'>,
    expectedUpdatedAt: Date
  ): Promise<MarketplaceAccountRecord | null> {
    const { rows } = await query<MarketplaceAccountRow>(
      `UPDATE marketplace_accounts
       SET handle = $3,
           credentials = $4::jsonb,
           status = $5,
           scopes = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND marketplace_id = $2
         AND status = 'connected'
         AND updated_at = $7
       RETURNING id, marketplace_id, handle, credentials, status, scopes, created_at, updated_at`,
      [
        account.id,
        account.marketplaceId,
        account.handle,
        JSON.stringify(account.credentials),
        account.status,
        account.scopes,
        expectedUpdatedAt,
      ],
      this.queryClient
    );
    return rows[0] ? MarketplaceAccountMapper.toRecord(rows[0]) : null;
  }
}
