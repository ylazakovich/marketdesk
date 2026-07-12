// Application-layer test doubles: in-memory implementations of the repositories and
// ports the domain testkit does not provide (workspace, activity log, price history,
// job queue) plus a deterministic id generator.

import type { Workspace } from '../../domain/entities/Workspace';
import type { IWorkspaceRepository } from '../../domain/repositories/interfaces/IWorkspaceRepository';
import type {
  IActivityLogRepository,
  ActivityLogEntry,
} from '../../domain/repositories/interfaces/IActivityLogRepository';
import type {
  IPriceHistoryRecorder,
  PriceHistoryRecord,
} from '../ports/IPriceHistoryRecorder';
import type { IJobQueue, JobEnqueueOptions } from '../ports/IJobQueue';
import type { IdGenerator } from '../ports/IdGenerator';

export class InMemoryWorkspaceRepository implements IWorkspaceRepository {
  readonly items = new Map<string, Workspace>();

  async findById(id: string): Promise<Workspace | null> {
    return this.items.get(id) ?? null;
  }
  async findAll(): Promise<Workspace[]> {
    return [...this.items.values()];
  }
  async save(workspace: Workspace): Promise<void> {
    this.items.set(workspace.id, workspace);
  }
}

export class InMemoryActivityLogRepository implements IActivityLogRepository {
  readonly entries: ActivityLogEntry[] = [];

  async record(entry: ActivityLogEntry): Promise<void> {
    this.entries.push(entry);
  }
  async findByWorkspace(workspaceId: string): Promise<ActivityLogEntry[]> {
    return this.entries.filter((e) => e.workspaceId === workspaceId);
  }
  async findByEntity(entityType: string, entityId: string): Promise<ActivityLogEntry[]> {
    return this.entries.filter(
      (e) => e.entityType === entityType && e.entityId === entityId,
    );
  }
}

export class RecordingPriceHistoryRecorder implements IPriceHistoryRecorder {
  readonly records: PriceHistoryRecord[] = [];

  async record(entry: PriceHistoryRecord): Promise<void> {
    this.records.push(entry);
  }
}

export class RecordingJobQueue<T = unknown> implements IJobQueue<T> {
  readonly jobs: Array<{ data: T; options?: JobEnqueueOptions }> = [];

  async enqueue(data: T, options?: JobEnqueueOptions): Promise<void> {
    this.jobs.push({ data, options });
  }
}

export function idFactory(prefix = 'id'): IdGenerator {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
