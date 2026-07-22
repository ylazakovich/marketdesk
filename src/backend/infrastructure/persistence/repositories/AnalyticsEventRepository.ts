import type { Pool, PoolClient } from 'pg';
import { query as databaseQuery } from '../../../config/database';
import type {
  AnalyticsEventQuery,
  AnalyticsEventRecord,
  AnalyticsEventType,
  IAnalyticsEventRepository,
} from '../../../application/ports/IAnalyticsEventRepository';

interface AnalyticsEventRow {
  id: string;
  workspace_id: string;
  listing_id: string | null;
  marketplace_id: string | null;
  event_type: string;
  quantity: number | string | null;
  amount: number | string | null;
  cost_at_sale: number | string | null;
  occurred_at: Date | string;
}

export class AnalyticsEventRepository implements IAnalyticsEventRepository {
  private readonly queryClient?: Pool | PoolClient;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client ?? pool;
  }

  async findByRange(input: AnalyticsEventQuery): Promise<AnalyticsEventRecord[]> {
    const values: unknown[] = [input.workspaceId, input.from, input.to];
    const marketplaceClause = input.marketplaceId
      ? ` AND l.marketplace_id = $${values.push(input.marketplaceId)}`
      : '';
    const sql = `
      SELECT e.id, e.workspace_id, e.listing_id, l.marketplace_id,
             e.event_type, e.quantity, e.amount, e.cost_at_sale, e.occurred_at
      FROM analytics_events e
      LEFT JOIN listings l ON l.id = e.listing_id
      WHERE e.workspace_id = $1
        AND e.occurred_at >= $2
        AND e.occurred_at < $3
        ${marketplaceClause}
      ORDER BY e.occurred_at ASC, e.id ASC
    `;
    const result: { rows: AnalyticsEventRow[] } = this.queryClient
      ? await this.queryClient.query(sql, values)
      : await databaseQuery<AnalyticsEventRow>(sql, values);
    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      listingId: row.listing_id,
      marketplaceId: row.marketplace_id,
      eventType: row.event_type as AnalyticsEventType,
      quantity: Number(row.quantity ?? 1),
      amount: row.amount === null ? null : Number(row.amount),
      costAtSale: row.cost_at_sale === null ? null : Number(row.cost_at_sale),
      occurredAt: new Date(row.occurred_at),
    }));
  }
}
