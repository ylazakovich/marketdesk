import type { PoolClient, Pool } from 'pg';
import { query } from '../../../config/database';
import type { IWorkspaceRepository } from '../../../domain/repositories/interfaces/IWorkspaceRepository';
import type { Workspace } from '../../../domain/entities/Workspace';
import { WorkspaceMapper } from '../mappers/WorkspaceMapper';
import type { WorkspaceRow } from '../mappers/rows';

const WORKSPACE_SELECT = `
  SELECT id, name, currency, timezone, autonomy_level, guardrails,
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
      this.queryClient,
    );
    const row = rows[0];
    return row ? WorkspaceMapper.toDomain(row) : null;
  }

  async findAll(): Promise<Workspace[]> {
    const { rows } = await query<WorkspaceRow>(
      `${WORKSPACE_SELECT} ORDER BY created_at ASC`,
      [],
      this.queryClient,
    );
    return rows.map((row) => WorkspaceMapper.toDomain(row));
  }

  async save(workspace: Workspace): Promise<void> {
    // Guardrails are persisted as JSONB (migration 007).
    await query(
      `INSERT INTO workspaces
         (id, name, currency, timezone, autonomy_level, guardrails,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         currency = EXCLUDED.currency,
         timezone = EXCLUDED.timezone,
         autonomy_level = EXCLUDED.autonomy_level,
         guardrails = EXCLUDED.guardrails,
         updated_at = EXCLUDED.updated_at`,
      [
        workspace.id,
        workspace.name,
        workspace.currency,
        workspace.timezone,
        workspace.autonomyLevel,
        JSON.stringify(workspace.guardrails),
        workspace.createdAt,
        workspace.updatedAt,
      ],
      this.queryClient,
    );
  }
}
