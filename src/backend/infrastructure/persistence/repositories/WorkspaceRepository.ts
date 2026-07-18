import type { PoolClient, Pool } from 'pg';
import { query } from '../../../config/database';
import type {
  IWorkspaceRepository,
  WorkspaceHermesPatch,
  WorkspacePartialPatch,
  WorkspaceProfilePatch,
} from '../../../domain/repositories/interfaces/IWorkspaceRepository';
import type { Workspace } from '../../../domain/entities/Workspace';
import { WorkspaceMapper } from '../mappers/WorkspaceMapper';
import type { WorkspaceRow } from '../mappers/rows';

const WORKSPACE_SELECT = `
  SELECT id, name, currency, timezone, language, autonomy_level, guardrails,
         created_at, updated_at
  FROM workspaces
`;

export class WorkspaceRepository implements IWorkspaceRepository {
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client || pool;
  }

  async findById(id: string): Promise<Workspace | null> {
    const { rows } = await query<WorkspaceRow>(
      `${WORKSPACE_SELECT} WHERE id = $1`,
      [id],
      this.queryClient
    );
    const row = rows[0];
    return row ? WorkspaceMapper.toDomain(row) : null;
  }

  async findAll(): Promise<Workspace[]> {
    const { rows } = await query<WorkspaceRow>(
      `${WORKSPACE_SELECT} ORDER BY created_at ASC`,
      [],
      this.queryClient
    );
    return rows.map((row) => WorkspaceMapper.toDomain(row));
  }

  async save(workspace: Workspace): Promise<void> {
    // Guardrails are persisted as JSONB (migration 007).
    await query(
      `INSERT INTO workspaces
         (id, name, currency, timezone, language, autonomy_level, guardrails,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         currency = EXCLUDED.currency,
         timezone = EXCLUDED.timezone,
         language = EXCLUDED.language,
         autonomy_level = EXCLUDED.autonomy_level,
         guardrails = EXCLUDED.guardrails,
         updated_at = EXCLUDED.updated_at`,
      [
        workspace.id,
        workspace.name,
        workspace.currency,
        workspace.timezone,
        workspace.language,
        workspace.autonomyLevel,
        JSON.stringify(workspace.guardrails),
        workspace.createdAt,
        workspace.updatedAt,
      ],
      this.queryClient
    );
  }

  async updateProfile(id: string, patch: WorkspaceProfilePatch): Promise<Workspace | null> {
    const { rows } = await query<WorkspaceRow>(
      `UPDATE workspaces SET
         name = COALESCE($2, name),
         currency = COALESCE($3, currency),
         timezone = COALESCE($4, timezone),
         language = COALESCE($5, language),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, currency, timezone, language, autonomy_level, guardrails,
                 created_at, updated_at`,
      [
        id,
        patch.name ?? null,
        patch.currency ?? null,
        patch.timezone ?? null,
        patch.language ?? null,
      ],
      this.queryClient
    );
    return rows[0] ? WorkspaceMapper.toDomain(rows[0]) : null;
  }

  async updateHermes(id: string, patch: WorkspaceHermesPatch): Promise<Workspace | null> {
    const { rows } = await query<WorkspaceRow>(
      `UPDATE workspaces SET
         autonomy_level = COALESCE($2, autonomy_level),
         guardrails = COALESCE(guardrails, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, currency, timezone, language, autonomy_level, guardrails,
                 created_at, updated_at`,
      [id, patch.autonomyLevel ?? null, patch.guardrails ? JSON.stringify(patch.guardrails) : null],
      this.queryClient
    );
    return rows[0] ? WorkspaceMapper.toDomain(rows[0]) : null;
  }

  async updatePartial(id: string, patch: WorkspacePartialPatch): Promise<Workspace | null> {
    const { rows } = await query<WorkspaceRow>(
      `UPDATE workspaces SET
         name = COALESCE($2, name),
         currency = COALESCE($3, currency),
         timezone = COALESCE($4, timezone),
         language = COALESCE($5, language),
         autonomy_level = COALESCE($6, autonomy_level),
         guardrails = COALESCE(guardrails, '{}'::jsonb) || COALESCE($7::jsonb, '{}'::jsonb),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, currency, timezone, language, autonomy_level, guardrails,
                 created_at, updated_at`,
      [
        id,
        patch.name ?? null,
        patch.currency ?? null,
        patch.timezone ?? null,
        patch.language ?? null,
        patch.autonomyLevel ?? null,
        patch.guardrails ? JSON.stringify(patch.guardrails) : null,
      ],
      this.queryClient
    );
    return rows[0] ? WorkspaceMapper.toDomain(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await query(`DELETE FROM workspaces WHERE id = $1`, [id], this.queryClient);
  }
}
