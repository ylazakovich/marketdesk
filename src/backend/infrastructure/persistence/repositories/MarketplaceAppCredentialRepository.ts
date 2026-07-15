import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type {
  MarketplaceAppCredentialRecord,
  MarketplaceAppCredentialRepository as MarketplaceAppCredentialRepositoryPort,
} from '../../../application/services/MarketplaceOAuthService';

export interface MarketplaceAppCredentialRow {
  id: string;
  marketplace_id: string;
  client_id: string;
  encrypted_client_secret: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

const CREDENTIAL_SELECT = `
  SELECT id, marketplace_id, client_id, encrypted_client_secret, created_at, updated_at
  FROM marketplace_app_credentials
`;

export const MarketplaceAppCredentialMapper = {
  toRecord(row: MarketplaceAppCredentialRow): MarketplaceAppCredentialRecord {
    return {
      id: row.id,
      marketplaceId: row.marketplace_id,
      clientId: row.client_id,
      encryptedClientSecret: row.encrypted_client_secret,
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    };
  },
};

export class MarketplaceAppCredentialRepository implements MarketplaceAppCredentialRepositoryPort {
  private readonly queryClient?: Pool | PoolClient;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client ?? pool;
  }

  async findByMarketplaceId(marketplaceId: string): Promise<MarketplaceAppCredentialRecord | null> {
    const { rows } = await query<MarketplaceAppCredentialRow>(
      `${CREDENTIAL_SELECT} WHERE marketplace_id = $1 LIMIT 1`,
      [marketplaceId],
      this.queryClient,
    );
    return rows[0] ? MarketplaceAppCredentialMapper.toRecord(rows[0]) : null;
  }

  async upsert(
    credentials: Omit<MarketplaceAppCredentialRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<MarketplaceAppCredentialRecord> {
    const { rows } = await query<MarketplaceAppCredentialRow>(
      `INSERT INTO marketplace_app_credentials
         (id, marketplace_id, client_id, encrypted_client_secret)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (marketplace_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         encrypted_client_secret = EXCLUDED.encrypted_client_secret,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, marketplace_id, client_id, encrypted_client_secret, created_at, updated_at`,
      [
        credentials.id,
        credentials.marketplaceId,
        credentials.clientId,
        JSON.stringify(credentials.encryptedClientSecret),
      ],
      this.queryClient,
    );
    const row = rows[0];
    if (!row) throw new Error('Marketplace app credential upsert returned no row');
    return MarketplaceAppCredentialMapper.toRecord(row);
  }

  async deleteByMarketplaceId(marketplaceId: string): Promise<void> {
    await query(
      'DELETE FROM marketplace_app_credentials WHERE marketplace_id = $1',
      [marketplaceId],
      this.queryClient,
    );
  }
}
