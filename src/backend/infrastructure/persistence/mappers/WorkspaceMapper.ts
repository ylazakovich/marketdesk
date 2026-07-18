import { Workspace } from '../../../domain/entities/Workspace';
import type { AutonomyLevel, WorkspaceLanguage } from '../../../../shared/types';
import type { WorkspaceRow } from './rows';
import { toDate, unwrapPersisted } from './support';

export const WorkspaceMapper = {
  // Guardrails are persisted as a JSONB column (migration 007). When the column
  // is NULL/absent (legacy rows, or a workspace saved before the migration),
  // Workspace.create falls back to DEFAULT_HERMES_GUARDRAILS.
  toDomain(row: WorkspaceRow): Workspace {
    return unwrapPersisted(
      Workspace.create({
        id: row.id,
        name: row.name,
        currency: row.currency,
        timezone: row.timezone,
        language: row.language as WorkspaceLanguage,
        autonomyLevel: row.autonomy_level as AutonomyLevel,
        guardrails: row.guardrails ?? undefined,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
      })
    );
  },
};
