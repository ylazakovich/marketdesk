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
  marketplace_key: MarketplaceKey;
  status: 'publishing' | 'published';
  external_listing_id: string | null;
  published_at: Date | string | null;
}

function toCheckpoint(row: PublishAttemptRow): PublishAttemptCheckpoint {
  return {
    operationId: row.operation_id,
    listingId: row.listing_id,
    marketplaceKey: row.marketplace_key,
    status: row.status,
    externalListingId: row.external_listing_id,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  };
}

export class PublishAttemptRepository implements PublishAttemptStore {
  constructor(private readonly pool: Pool) {}

  async find(operationId: string): Promise<PublishAttemptCheckpoint | null> {
    const result = await this.pool.query<PublishAttemptRow>(
      `SELECT operation_id, listing_id, marketplace_key, status, external_listing_id, published_at
       FROM marketplace_publish_attempts
       WHERE operation_id = $1`,
      [operationId]
    );
    return result.rows[0] ? toCheckpoint(result.rows[0]) : null;
  }

  async begin(
    operationId: string,
    listingId: string,
    marketplaceKey: MarketplaceKey
  ): Promise<{ created: boolean; checkpoint: PublishAttemptCheckpoint }> {
    const inserted = await this.pool.query<PublishAttemptRow>(
      `INSERT INTO marketplace_publish_attempts
         (operation_id, listing_id, marketplace_key, status)
       VALUES ($1, $2, $3, 'publishing')
       ON CONFLICT (operation_id) DO NOTHING
       RETURNING operation_id, listing_id, marketplace_key, status,
                 external_listing_id, published_at`,
      [operationId, listingId, marketplaceKey]
    );
    if (inserted.rows[0]) {
      return { created: true, checkpoint: toCheckpoint(inserted.rows[0]) };
    }

    const existing = await this.find(operationId);
    if (!existing) {
      throw new Error(`Publish checkpoint disappeared after conflict: ${operationId}`);
    }
    return { created: false, checkpoint: existing };
  }

  async markPublished(operationId: string, result: PublishResult): Promise<void> {
    const updated = await this.pool.query(
      `UPDATE marketplace_publish_attempts
       SET status = 'published',
           external_listing_id = $2,
           published_at = $3,
           updated_at = NOW()
       WHERE operation_id = $1`,
      [operationId, result.externalListingId, result.publishedAt]
    );
    if (updated.rowCount !== 1) {
      throw new Error(`Publish checkpoint not found: ${operationId}`);
    }
  }
}
