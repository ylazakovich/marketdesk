import type { PoolClient, Pool } from 'pg';
import { query, withTransaction } from '../../../config/database';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { Listing } from '../../../domain/entities/Listing';
import { ListingMapper } from '../mappers/ListingMapper';
import type { ListingRow } from '../mappers/rows';

// listings carry no currency column; join products -> workspaces for Money.
const LISTING_SELECT = `
  SELECT l.id, l.product_id, l.marketplace_id, l.marketplace_listing_id, l.external_url, l.price,
         l.status, l.views, l.watchers, l.messages, l.published_at, l.expires_at,
         l.sync_error, l.last_sync_at, l.created_at, l.updated_at, w.currency
  FROM listings l
  JOIN products p ON p.id = l.product_id
  JOIN workspaces w ON w.id = p.workspace_id
`;

export class ListingRepository implements IListingRepository {
  private readonly pool?: Pool;
  private readonly client?: PoolClient;
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.pool = pool;
    this.client = client;
    this.queryClient = client || pool;
  }

  async findById(id: string): Promise<Listing | null> {
    const { rows } = await query<ListingRow>(
      `${LISTING_SELECT} WHERE l.id = $1`,
      [id],
      this.queryClient,
    );
    const row = rows[0];
    return row ? ListingMapper.toDomain(row) : null;
  }

  async findByIdForWorkspace(
    id: string,
    workspaceId: string,
  ): Promise<Listing | null> {
    const { rows } = await query<ListingRow>(
      `${LISTING_SELECT} WHERE l.id = $1 AND p.workspace_id = $2`,
      [id, workspaceId],
      this.queryClient,
    );
    const row = rows[0];
    return row ? ListingMapper.toDomain(row) : null;
  }

  async findByProduct(productId: string): Promise<Listing[]> {
    const { rows } = await query<ListingRow>(
      `${LISTING_SELECT} WHERE l.product_id = $1 ORDER BY l.created_at DESC`,
      [productId],
      this.queryClient,
    );
    return rows.map((row) => ListingMapper.toDomain(row));
  }

  async findByMarketplace(marketplaceId: string): Promise<Listing[]> {
    const { rows } = await query<ListingRow>(
      `${LISTING_SELECT} WHERE l.marketplace_id = $1 ORDER BY l.created_at DESC`,
      [marketplaceId],
      this.queryClient,
    );
    return rows.map((row) => ListingMapper.toDomain(row));
  }

  async findByWorkspace(workspaceId: string): Promise<Listing[]> {
    const { rows } = await query<ListingRow>(
      `${LISTING_SELECT} WHERE p.workspace_id = $1 ORDER BY l.created_at DESC`,
      [workspaceId],
      this.queryClient,
    );
    return rows.map((row) => ListingMapper.toDomain(row));
  }

  async findExpiring(before: Date): Promise<Listing[]> {
    const { rows } = await query<ListingRow>(
      `${LISTING_SELECT}
       WHERE l.status = 'live'
         AND l.expires_at IS NOT NULL
         AND l.expires_at < $1
       ORDER BY l.expires_at ASC`,
      [before],
      this.queryClient,
    );
    return rows.map((row) => ListingMapper.toDomain(row));
  }

  async save(listing: Listing): Promise<void> {
    if (this.client) {
      await this.persist(listing, this.client);
      return;
    }
    await withTransaction((client) => this.persist(listing, client));
  }

  async saveAll(listings: Listing[]): Promise<void> {
    const run = async (client: PoolClient): Promise<void> => {
      for (const listing of listings) {
        await this.persist(listing, client);
      }
    };
    if (this.client) {
      await run(this.client);
      return;
    }
    await withTransaction(run);
  }

  async delete(id: string): Promise<void> {
    await query(`DELETE FROM listings WHERE id = $1`, [id], this.client);
  }

  private async persist(listing: Listing, client: PoolClient): Promise<void> {
    await query(
      `INSERT INTO listings
         (id, product_id, marketplace_id, marketplace_listing_id, external_url, price, status,
          views, watchers, messages, published_at, expires_at, sync_error,
          last_sync_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET
         marketplace_listing_id = EXCLUDED.marketplace_listing_id,
         external_url = EXCLUDED.external_url,
         price = EXCLUDED.price,
         status = EXCLUDED.status,
         views = EXCLUDED.views,
         watchers = EXCLUDED.watchers,
         messages = EXCLUDED.messages,
         published_at = EXCLUDED.published_at,
         expires_at = EXCLUDED.expires_at,
         sync_error = EXCLUDED.sync_error,
         last_sync_at = EXCLUDED.last_sync_at,
         updated_at = EXCLUDED.updated_at`,
      [
        listing.id,
        listing.productId,
        listing.marketplaceId,
        listing.marketplaceListingId,
        listing.externalUrl,
        listing.price.amount,
        listing.status,
        listing.views,
        listing.watchers,
        listing.messages,
        listing.publishedAt,
        listing.expiresAt,
        listing.syncError,
        listing.lastSyncAt,
        listing.createdAt,
        listing.updatedAt,
      ],
      client,
    );
  }
}
