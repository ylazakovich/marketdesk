import type { PoolClient, Pool } from 'pg';
import { query } from '../../../config/database';
import type {
  ActivityLogEntry,
  IActivityLogRepository,
} from '../../../domain/repositories/interfaces/IActivityLogRepository';
import { ActivityLogMapper } from '../mappers/ActivityLogMapper';
import type { ActivityLogRow } from '../mappers/rows';

const ACTIVITY_SELECT = `
  SELECT id, workspace_id, entity_type, entity_id, actor_type, actor_id,
         action, metadata, created_at
  FROM activity_log
`;

export class ActivityLogRepository implements IActivityLogRepository {
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client || pool;
  }

  // Append-only: entries are recorded once and never updated.
  async record(entry: ActivityLogEntry): Promise<void> {
    await query(
      `INSERT INTO activity_log
         (id, workspace_id, entity_type, entity_id, actor_type, actor_id,
          action, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.workspaceId,
        entry.entityType,
        entry.entityId,
        entry.actorType,
        entry.actorId ?? null,
        entry.action,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.createdAt,
      ],
      this.queryClient,
    );
  }

  async findByWorkspace(workspaceId: string): Promise<ActivityLogEntry[]> {
    const { rows } = await query<ActivityLogRow>(
      `${ACTIVITY_SELECT} WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [workspaceId],
      this.queryClient,
    );
    return rows.map((row) => ActivityLogMapper.toDomain(row));
  }

  async findByEntity(
    entityType: string,
    entityId: string,
  ): Promise<ActivityLogEntry[]> {
    const { rows } = await query<ActivityLogRow>(
      `${ACTIVITY_SELECT} WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC`,
      [entityType, entityId],
      this.queryClient,
    );
    return rows.map((row) => ActivityLogMapper.toDomain(row));
  }
}
