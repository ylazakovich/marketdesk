import type { PoolClient, Pool } from 'pg';
import { query, withTransaction } from '../../../config/database';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { Listing } from '../../../domain/entities/Listing';
import { ListingMapper } from '../mappers/ListingMapper';
import type { ListingRow } from '../mappers/rows';
import { InvalidStateError } from '../../../domain/shared/DomainError';

// listings carry no currency column; join products -> workspaces for Money.
const LISTING_SELECT = `
  SELECT l.id, l.product_id, l.marketplace_id, l.marketplace_listing_id, l.external_url, l.price,
         l.status, l.remote_status, l.marketplace_category, l.views, l.watchers, l.messages, l.published_at, l.expires_at,
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

  async saveAfterConfirmedDelist(listing: Listing, expectedExternalListingId: string): Promise<void> {
    const run = async (client: PoolClient): Promise<void> => {
      const result = await query(
        `UPDATE listings SET
           marketplace_listing_id = $2, external_url = $3, status = $4, remote_status = $5,
           published_at = $6, expires_at = $7, sync_error = $8, last_sync_at = $9, updated_at = $10
         WHERE id = $1 AND marketplace_listing_id = $11 AND status = 'live'
         RETURNING id`,
        [
          listing.id, listing.marketplaceListingId, listing.externalUrl, listing.status,
          listing.remoteStatus, listing.publishedAt, listing.expiresAt, listing.syncError,
          listing.lastSyncAt, listing.updatedAt, expectedExternalListingId,
        ],
        client,
      );
      if (result.rowCount !== 1) {
        throw new InvalidStateError(
          `Listing remote identity changed concurrently; reconcile delist: ${listing.id}`,
        );
      }
    };
    if (this.client) return run(this.client);
    await withTransaction(run);
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

  async saveAllIfUnchanged(
    listings: Listing[],
    expectedUpdatedAt: ReadonlyMap<string, Date>,
  ): Promise<void> {
    const run = async (client: PoolClient): Promise<void> => {
      for (const listing of [...listings].sort((a, b) => a.id.localeCompare(b.id))) {
        const expected = expectedUpdatedAt.get(listing.id);
        if (!expected) throw new InvalidStateError(`Missing listing version: ${listing.id}`);
        await this.updateIfUnchanged(listing, expected, client);
      }
    };
    if (this.client) return run(this.client);
    await withTransaction(run);
  }

  async delete(id: string): Promise<void> {
    await query(`DELETE FROM listings WHERE id = $1`, [id], this.client);
  }

  private async persist(listing: Listing, client: PoolClient): Promise<void> {
    await query(
      `INSERT INTO listings
         (id, product_id, marketplace_id, marketplace_listing_id, external_url, price, status, remote_status,
          marketplace_category, views, watchers, messages, published_at, expires_at, sync_error,
          last_sync_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (id) DO UPDATE SET
         marketplace_listing_id = EXCLUDED.marketplace_listing_id,
         external_url = EXCLUDED.external_url,
         price = EXCLUDED.price,
         status = EXCLUDED.status,
         remote_status = EXCLUDED.remote_status,
         marketplace_category = EXCLUDED.marketplace_category,
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
        listing.remoteStatus,
        listing.marketplaceCategory ? JSON.stringify(listing.marketplaceCategory) : null,
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

  private async updateIfUnchanged(
    listing: Listing,
    expectedUpdatedAt: Date,
    client: PoolClient,
  ): Promise<void> {
    const result = await query(
      `UPDATE listings SET
         marketplace_listing_id = $2, external_url = $3, price = $4, status = $5,
         remote_status = $6, marketplace_category = $7, views = $8, watchers = $9,
         messages = $10, published_at = $11, expires_at = $12, sync_error = $13,
         last_sync_at = $14, updated_at = $15
       WHERE id = $1 AND updated_at = $16
       RETURNING id`,
      [
        listing.id, listing.marketplaceListingId, listing.externalUrl, listing.price.amount,
        listing.status, listing.remoteStatus,
        listing.marketplaceCategory ? JSON.stringify(listing.marketplaceCategory) : null,
        listing.views, listing.watchers, listing.messages, listing.publishedAt, listing.expiresAt,
        listing.syncError, listing.lastSyncAt, listing.updatedAt, expectedUpdatedAt,
      ],
      client,
    );
    if (result.rowCount !== 1) {
      throw new InvalidStateError(`Listing changed concurrently; retry sync: ${listing.id}`);
    }
  }
}
