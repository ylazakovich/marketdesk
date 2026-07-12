import type { ActorType } from '../../../../shared/types';

export interface ActivityLogEntry {
  id: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  actorType: ActorType;
  actorId?: string;
  action: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface IActivityLogRepository {
  record(entry: ActivityLogEntry): Promise<void>;
  findByWorkspace(workspaceId: string): Promise<ActivityLogEntry[]>;
  findByEntity(entityType: string, entityId: string): Promise<ActivityLogEntry[]>;
}
