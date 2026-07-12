// Concrete price-history store backed by the `price_history` table (migration
// 004). Price history is an audit projection, not a domain aggregate, so the
// application expresses it as two ports: IPriceHistoryReader (read path, serves
// GET /listings/:id/price-history) and IPriceHistoryRecorder (write path, called
// on Hermes price approval and manual listing price edits). This single
// repository satisfies both. The row<->view mapping is a pure static for
// database-free unit testing.

import type { PoolClient, Pool } from 'pg';
import { query } from '../../../config/database';
import type { IPriceHistoryReader } from '../../../application/ports/IPriceHistoryReader';
import type {
  IPriceHistoryRecorder,
  PriceHistoryRecord,
} from '../../../application/ports/IPriceHistoryRecorder';
import type { PriceHistory, ChangedBy } from '../../../../shared/types';
import { toNumber } from '../mappers/support';

export interface PriceHistoryRow {
  id: string;
  listing_id: string;
  old_price: string | number | null;
  new_price: string | number;
  changed_by: string;
  reason: string | null;
  created_at: Date | string;
}

const PRICE_HISTORY_SELECT = `
  SELECT id, listing_id, old_price, new_price, changed_by, reason, created_at
  FROM price_history
`;

export const PriceHistoryMapper = {
  // DECIMAL columns come back from node-pg as strings; created_at is serialized
  // to ISO for the shared PriceHistory view type.
  toView(row: PriceHistoryRow): PriceHistory {
    const createdAt =
      row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    return {
      id: row.id,
      listingId: row.listing_id,
      oldPrice: row.old_price === null ? undefined : toNumber(row.old_price),
      newPrice: toNumber(row.new_price),
      changedBy: row.changed_by as ChangedBy,
      reason: row.reason ?? undefined,
      createdAt: createdAt.toISOString(),
    };
  },
};

export class PriceHistoryRepository
  implements IPriceHistoryReader, IPriceHistoryRecorder
{
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client || pool;
  }

  // Read path — most recent first (matches idx_price_history_listing_date).
  async findByListing(listingId: string): Promise<PriceHistory[]> {
    const { rows } = await query<PriceHistoryRow>(
      `${PRICE_HISTORY_SELECT} WHERE listing_id = $1 ORDER BY created_at DESC`,
      [listingId],
      this.queryClient,
    );
    return rows.map((row) => PriceHistoryMapper.toView(row));
  }

  // Write path — append-only audit record.
  async record(entry: PriceHistoryRecord): Promise<void> {
    await query(
      `INSERT INTO price_history
         (id, listing_id, old_price, new_price, changed_by, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.id,
        entry.listingId,
        entry.oldPrice ?? null,
        entry.newPrice,
        entry.changedBy,
        entry.reason ?? null,
        entry.createdAt,
      ],
      this.queryClient,
    );
  }
}
