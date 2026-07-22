import type { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { query as databaseQuery } from '../../../config/database';
import type {
  AnalyticsEventQuery,
  AnalyticsEventRecord,
  AppendAnalyticsEvent,
  AnalyticsEventType,
  IAnalyticsEventRepository,
} from '../../../application/ports/IAnalyticsEventRepository';

interface AnalyticsEventRow {
  id: string;
  workspace_id: string;
  listing_id: string | null;
  marketplace_id: string | null;
  currency: string | null;
  event_type: string;
  quantity: number | string;
  amount: number | string | null;
  cost_at_sale: number | string | null;
  occurred_at: Date | string;
}

export class AnalyticsEventRepository implements IAnalyticsEventRepository {
  private readonly queryClient?: Pool | PoolClient;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client ?? pool;
  }

  private async run(sql: string, values: unknown[]): Promise<void> {
    if (this.queryClient) await this.queryClient.query(sql, values);
    else await databaseQuery(sql, values);
  }

  async findByRange(input: AnalyticsEventQuery): Promise<AnalyticsEventRecord[]> {
    const values: unknown[] = [input.workspaceId, input.from, input.to];
    const marketplaceClause = input.marketplaceId
      ? ` AND COALESCE(e.marketplace_id, l.marketplace_id) = $${values.push(input.marketplaceId)}`
      : '';
    const sql = `
      SELECT e.id, e.workspace_id, e.listing_id,
             COALESCE(e.marketplace_id, l.marketplace_id) AS marketplace_id,
             e.event_type, e.quantity, e.amount, e.cost_at_sale, e.currency, e.occurred_at
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
      currency: row.currency,
      eventType: row.event_type as AnalyticsEventType,
      quantity: Number(row.quantity),
      amount: row.amount === null ? null : Number(row.amount),
      costAtSale: row.cost_at_sale === null ? null : Number(row.cost_at_sale),
      occurredAt: new Date(row.occurred_at),
    }));
  }

  async appendMany(events: AppendAnalyticsEvent[]): Promise<void> {
    for (const event of events) {
      if (!Number.isInteger(event.quantity) || event.quantity <= 0) continue;
      const hex = createHash('sha256').update(event.idempotencyKey).digest('hex');
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      await this.run(
        `INSERT INTO analytics_events
          (id, workspace_id, listing_id, marketplace_id, event_type, quantity, amount, cost_at_sale, currency, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [id, event.workspaceId, event.listingId, event.marketplaceId, event.eventType, event.quantity,
          event.amount, event.costAtSale, event.currency, event.occurredAt],
      );
    }
  }
}
