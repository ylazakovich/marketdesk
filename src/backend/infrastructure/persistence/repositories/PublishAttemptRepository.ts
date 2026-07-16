import type { Pool } from 'pg';
import type { MarketplaceKey } from '../../../../shared/types';
import type { PublishResult } from '../../../domain/services/MarketplaceAdapter';
import type {
  PublishAttemptCheckpoint,
  PublishAttemptStore,
} from '../../jobQueue/JobHandlers/PublishListingHandler';

interface PublishAttemptRow {
  operation_id: string;
  listing_id: string;
  listing_updated_at: Date | string;
  marketplace_key: MarketplaceKey;
  status: 'publishing' | 'published' | 'finalized' | 'abandoned';
  external_listing_id: string | null;
  external_url: string | null;
  published_at: Date | string | null;
  remote_status: string | null;
  remote_image_urls: string[] | null;
}

const SELECT_COLUMNS =
  'operation_id, listing_id, listing_updated_at, marketplace_key, status, external_listing_id, external_url, published_at, remote_status, remote_image_urls';

function toCheckpoint(row: PublishAttemptRow): PublishAttemptCheckpoint {
  return {
    operationId: row.operation_id,
    listingId: row.listing_id,
    listingUpdatedAt: new Date(row.listing_updated_at),
    marketplaceKey: row.marketplace_key,
    status: row.status,
    externalListingId: row.external_listing_id,
    externalUrl: row.external_url,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    remoteStatus: row.remote_status ?? null,
    remoteImageUrls: row.remote_image_urls ?? [],
  };
}

export class PublishAttemptRepository implements PublishAttemptStore {
  constructor(private readonly pool: Pool) {}

  async find(operationId: string): Promise<PublishAttemptCheckpoint | null> {
    const result = await this.pool.query<PublishAttemptRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM marketplace_publish_attempts
       WHERE operation_id = $1`,
      [operationId]
    );
    return result.rows[0] ? toCheckpoint(result.rows[0]) : null;
  }

  async begin(
    operationId: string,
    listingId: string,
    marketplaceKey: MarketplaceKey,
    listingUpdatedAt: Date
  ): Promise<{ created: boolean; checkpoint: PublishAttemptCheckpoint }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latest = await this.findLatestByListing(listingId);
      if (latest && latest.listingUpdatedAt.getTime() >= listingUpdatedAt.getTime()) {
        return { created: false, checkpoint: latest };
      }
      const inserted = await this.pool.query<PublishAttemptRow>(
        `INSERT INTO marketplace_publish_attempts
           (operation_id, listing_id, listing_updated_at, marketplace_key, status)
         VALUES ($1, $2, $4, $3, 'publishing')
         ON CONFLICT DO NOTHING
         RETURNING ${SELECT_COLUMNS}`,
        [operationId, listingId, marketplaceKey, listingUpdatedAt]
      );
      if (inserted.rows[0]) {
        return { created: true, checkpoint: toCheckpoint(inserted.rows[0]) };
      }

      const existing =
        (await this.find(operationId)) ??
        (await this.findByListingGeneration(listingId, listingUpdatedAt)) ??
        (await this.findActiveByListing(listingId)) ??
        (await this.findLatestByListing(listingId));
      if (existing) return { created: false, checkpoint: existing };
    }
    throw new Error(`Publish checkpoint conflict could not be resolved: ${operationId}`);
  }

  async markPublished(operationId: string, result: PublishResult): Promise<void> {
    const updated = await this.pool.query(
      `UPDATE marketplace_publish_attempts
       SET status = 'published',
           external_listing_id = $2,
           external_url = $3,
           published_at = $4,
           remote_status = $5,
           remote_image_urls = $6,
           updated_at = NOW()
       WHERE operation_id = $1`,
      [
        operationId,
        result.externalListingId,
        result.externalUrl ?? null,
        result.publishedAt,
        result.remoteStatus ?? null,
        result.remoteImageUrls ?? [],
      ]
    );
    if (updated.rowCount !== 1) {
      throw new Error(`Publish checkpoint not found: ${operationId}`);
    }
  }

  async markFinalized(operationId: string): Promise<void> {
    const updated = await this.pool.query(
      `UPDATE marketplace_publish_attempts
       SET status = 'finalized', updated_at = NOW()
       WHERE operation_id = $1 AND status IN ('published', 'finalized')`,
      [operationId]
    );
    if (updated.rowCount !== 1) {
      throw new Error(`Published checkpoint not found: ${operationId}`);
    }
  }

  private async findActiveByListing(listingId: string): Promise<PublishAttemptCheckpoint | null> {
    const result = await this.pool.query<PublishAttemptRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM marketplace_publish_attempts
       WHERE listing_id = $1 AND status IN ('publishing', 'published')
       ORDER BY created_at DESC
       LIMIT 1`,
      [listingId]
    );
    return result.rows[0] ? toCheckpoint(result.rows[0]) : null;
  }

  private async findByListingGeneration(
    listingId: string,
    listingUpdatedAt: Date
  ): Promise<PublishAttemptCheckpoint | null> {
    const result = await this.pool.query<PublishAttemptRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM marketplace_publish_attempts
       WHERE listing_id = $1 AND listing_updated_at = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [listingId, listingUpdatedAt]
    );
    return result.rows[0] ? toCheckpoint(result.rows[0]) : null;
  }

  private async findLatestByListing(listingId: string): Promise<PublishAttemptCheckpoint | null> {
    const result = await this.pool.query<PublishAttemptRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM marketplace_publish_attempts
       WHERE listing_id = $1
       ORDER BY listing_updated_at DESC, created_at DESC
       LIMIT 1`,
      [listingId]
    );
    return result.rows[0] ? toCheckpoint(result.rows[0]) : null;
  }
}
