import type { PoolClient, Pool } from 'pg';
import { query, withTransaction } from '../../../config/database';
import type { IEventRepository } from '../../../domain/repositories/interfaces/IEventRepository';
import type { HermesEvent } from '../../../domain/entities/HermesEvent';
import type { HermesEventStatus } from '../../../../shared/types';
import { EventMapper } from '../mappers/EventMapper';
import type { HermesEventRow } from '../mappers/rows';

const EVENT_SELECT = `
  SELECT id, workspace_id, product_id, type, severity, status, title, detail,
         proposed_change, autonomy_decision, created_at, resolved_at
  FROM hermes_events
`;

export class EventRepository implements IEventRepository {
  private readonly pool?: Pool;
  private readonly client?: PoolClient;
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.pool = pool;
    this.client = client;
    this.queryClient = client || pool;
  }

  async findById(id: string): Promise<HermesEvent | null> {
    const { rows } = await query<HermesEventRow>(
      `${EVENT_SELECT} WHERE id = $1`,
      [id],
      this.queryClient,
    );
    const row = rows[0];
    return row ? EventMapper.toDomain(row) : null;
  }

  async findByIdForWorkspace(
    id: string,
    workspaceId: string,
  ): Promise<HermesEvent | null> {
    const { rows } = await query<HermesEventRow>(
      `${EVENT_SELECT} WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
      this.queryClient,
    );
    const row = rows[0];
    return row ? EventMapper.toDomain(row) : null;
  }

  async findByWorkspace(workspaceId: string): Promise<HermesEvent[]> {
    const { rows } = await query<HermesEventRow>(
      `${EVENT_SELECT} WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [workspaceId],
      this.queryClient,
    );
    return rows.map((row) => EventMapper.toDomain(row));
  }

  async findByStatus(
    workspaceId: string,
    status: HermesEventStatus,
  ): Promise<HermesEvent[]> {
    const { rows } = await query<HermesEventRow>(
      `${EVENT_SELECT} WHERE workspace_id = $1 AND status = $2 ORDER BY created_at DESC`,
      [workspaceId, status],
      this.queryClient,
    );
    return rows.map((row) => EventMapper.toDomain(row));
  }

  async findPendingReview(workspaceId: string): Promise<HermesEvent[]> {
    return this.findByStatus(workspaceId, 'pending_review');
  }

  async save(event: HermesEvent): Promise<void> {
    await this.persist(event, this.queryClient as PoolClient);
  }

  async saveAll(events: HermesEvent[]): Promise<void> {
    const run = async (client: PoolClient): Promise<void> => {
      for (const event of events) {
        await this.persist(event, client);
      }
    };
    if (this.client) {
      await run(this.client);
      return;
    }
    await withTransaction(run);
  }

  async deleteOlderThan(cutoff: Date): Promise<void> {
    await query(
      `DELETE FROM hermes_events WHERE created_at < $1`,
      [cutoff],
      this.queryClient,
    );
  }

  private async persist(event: HermesEvent, client?: PoolClient): Promise<void> {
    const proposedChange =
      event.proposedChange === null ? null : JSON.stringify(event.proposedChange);

    await query(
      `INSERT INTO hermes_events
         (id, workspace_id, product_id, type, severity, status, title, detail,
          proposed_change, autonomy_decision, created_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         severity = EXCLUDED.severity,
         status = EXCLUDED.status,
         title = EXCLUDED.title,
         detail = EXCLUDED.detail,
         proposed_change = EXCLUDED.proposed_change,
         autonomy_decision = EXCLUDED.autonomy_decision,
         resolved_at = EXCLUDED.resolved_at`,
      [
        event.id,
        event.workspaceId,
        event.productId,
        event.type,
        event.severity,
        event.status,
        event.title,
        event.detail,
        proposedChange,
        event.autonomyDecision,
        event.createdAt,
        event.resolvedAt,
      ],
      client,
    );
  }
}
