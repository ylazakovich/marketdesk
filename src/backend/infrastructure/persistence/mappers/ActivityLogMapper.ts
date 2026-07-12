import type { ActivityLogEntry } from '../../../domain/repositories/interfaces/IActivityLogRepository';
import type { ActorType } from '../../../../shared/types';
import type { ActivityLogRow } from './rows';
import { toDate } from './support';

export const ActivityLogMapper = {
  toDomain(row: ActivityLogRow): ActivityLogEntry {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorType: row.actor_type as ActorType,
      actorId: row.actor_id ?? undefined,
      action: row.action,
      metadata: row.metadata ?? undefined,
      createdAt: toDate(row.created_at),
    };
  },
};
