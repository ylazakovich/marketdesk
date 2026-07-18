// Application-layer test doubles: in-memory implementations of the repositories and
// ports the domain testkit does not provide (workspace, activity log, price history,
// job queue) plus a deterministic id generator.

import type { Workspace } from '../../domain/entities/Workspace';
import type {
  IWorkspaceRepository,
  WorkspaceHermesPatch,
  WorkspacePartialPatch,
  WorkspaceProfilePatch,
} from '../../domain/repositories/interfaces/IWorkspaceRepository';
import { Workspace as WorkspaceEntity } from '../../domain/entities/Workspace';
import { normalizeWorkspacePatch } from '../../domain/services/workspaceSettingsValidation';
import type {
  IActivityLogRepository,
  ActivityLogEntry,
} from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IPriceHistoryRecorder, PriceHistoryRecord } from '../ports/IPriceHistoryRecorder';
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
  async updateProfile(id: string, patch: WorkspaceProfilePatch): Promise<Workspace | null> {
    const normalized = normalizeWorkspacePatch(patch);
    const current = this.items.get(id);
    if (!current) return null;
    const result = WorkspaceEntity.create({
      id,
      name: normalized.name ?? current.name,
      currency: normalized.currency ?? current.currency,
      timezone: normalized.timezone ?? current.timezone,
      language: normalized.language ?? current.language,
      autonomyLevel: current.autonomyLevel,
      guardrails: current.guardrails,
      createdAt: current.createdAt,
    });
    if (result.isErr()) throw result.error;
    this.items.set(id, result.value);
    return result.value;
  }
  async updateHermes(id: string, patch: WorkspaceHermesPatch): Promise<Workspace | null> {
    const normalized = normalizeWorkspacePatch(patch);
    const current = this.items.get(id);
    if (!current) return null;
    const result = WorkspaceEntity.create({
      id,
      name: current.name,
      currency: current.currency,
      timezone: current.timezone,
      language: current.language,
      autonomyLevel: normalized.autonomyLevel ?? current.autonomyLevel,
      guardrails: { ...current.guardrails, ...normalized.guardrails },
      createdAt: current.createdAt,
    });
    if (result.isErr()) throw result.error;
    const validated = result.value.updateGuardrails({});
    if (validated.isErr()) throw validated.error;
    this.items.set(id, result.value);
    return result.value;
  }
  async updatePartial(id: string, patch: WorkspacePartialPatch): Promise<Workspace | null> {
    const normalized = normalizeWorkspacePatch(patch);
    const current = this.items.get(id);
    if (!current) return null;
    const result = WorkspaceEntity.create({
      id,
      name: normalized.name ?? current.name,
      currency: normalized.currency ?? current.currency,
      timezone: normalized.timezone ?? current.timezone,
      language: normalized.language ?? current.language,
      autonomyLevel: normalized.autonomyLevel ?? current.autonomyLevel,
      guardrails: { ...current.guardrails, ...normalized.guardrails },
      createdAt: current.createdAt,
    });
    if (result.isErr()) throw result.error;
    this.items.set(id, result.value);
    return result.value;
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryActivityLogRepository implements IActivityLogRepository {
  readonly entries: ActivityLogEntry[] = [];

  async record(entry: ActivityLogEntry): Promise<void> {
    if (this.entries.some((existing) => existing.id === entry.id)) return;
    this.entries.push(entry);
  }
  async findByWorkspace(workspaceId: string): Promise<ActivityLogEntry[]> {
    return this.entries.filter((e) => e.workspaceId === workspaceId);
  }
  async findByEntity(entityType: string, entityId: string): Promise<ActivityLogEntry[]> {
    return this.entries.filter((e) => e.entityType === entityType && e.entityId === entityId);
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
