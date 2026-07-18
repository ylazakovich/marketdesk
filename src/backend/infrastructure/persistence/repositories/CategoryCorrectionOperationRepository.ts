import type { Pool, PoolClient } from 'pg';
import { query, withTransaction } from '../../../config/database';
import type {
  CategoryCorrectionOperation,
  ICategoryCorrectionOperationRepository,
} from '../../../domain/repositories/interfaces/ICategoryCorrectionOperationRepository';

interface OperationRow {
  id: string;
  workspace_id: string;
  recommendation_event_id: string | null;
  listing_id: string;
  marketplace_id: string;
  kind: CategoryCorrectionOperation['kind'];
  state: CategoryCorrectionOperation['state'];
  target_category: CategoryCorrectionOperation['targetCategory'];
  paid_override_reason: string | null;
  requested_by: string | null;
  approved_by: string | null;
  result: Record<string, unknown> | null;
  requested_at: Date;
  approved_at: Date | null;
  executed_at: Date | null;
  failed_at: Date | null;
  updated_at: Date;
}

const SELECT = `SELECT id, workspace_id, recommendation_event_id, listing_id, marketplace_id,
  kind, state, target_category, paid_override_reason, requested_by, approved_by, result,
  requested_at, approved_at, executed_at, failed_at, updated_at
  FROM category_correction_operations`;

export class CategoryCorrectionOperationRepository implements ICategoryCorrectionOperationRepository {
  private readonly queryClient?: Pool | PoolClient;

  constructor(private readonly pool?: Pool, private readonly client?: PoolClient) {
    this.queryClient = client ?? pool;
  }

  async create(operation: CategoryCorrectionOperation): Promise<CategoryCorrectionOperation> {
    await this.insert(operation);
    const created = await this.findByIdForWorkspace(operation.id, operation.workspaceId);
    if (!created) throw new Error('Category correction operation ID is already in use');
    return created;
  }

  async createPair(
    delist: CategoryCorrectionOperation,
    recreate: CategoryCorrectionOperation,
  ): Promise<void> {
    if (!delist.recommendationEventId
      || delist.recommendationEventId !== recreate.recommendationEventId
      || delist.listingId !== recreate.listingId) {
      throw new Error('Category correction pair must share recommendation and listing');
    }
    const run = async (client?: PoolClient): Promise<void> => {
      await this.insert(delist, client);
      await this.insert(recreate, client);
    };
    if (this.client) return run(this.client);
    if (!this.pool) return withTransaction((client) => run(client));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await run(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByIdForWorkspace(id: string, workspaceId: string): Promise<CategoryCorrectionOperation | null> {
    const { rows } = await query<OperationRow>(`${SELECT} WHERE id = $1 AND workspace_id = $2`, [id, workspaceId], this.queryClient);
    return rows[0] ? this.map(rows[0]) : null;
  }

  async findByRecommendationForWorkspace(recommendationEventId: string, workspaceId: string): Promise<CategoryCorrectionOperation[]> {
    const { rows } = await query<OperationRow>(
      `${SELECT} WHERE recommendation_event_id = $1 AND workspace_id = $2 ORDER BY CASE kind WHEN 'delist' THEN 0 ELSE 1 END`,
      [recommendationEventId, workspaceId],
      this.queryClient,
    );
    return rows.map((row) => this.map(row));
  }

  async approve(input: { id: string; workspaceId: string; actorId: string; paidOverrideReason?: string; targetCategory?: CategoryCorrectionOperation['targetCategory']; at: Date }): Promise<CategoryCorrectionOperation | null> {
    const { rows } = await query<OperationRow>(
      `UPDATE category_correction_operations
       SET state = 'approved', approved_by = $3, approved_at = $4,
           paid_override_reason = $5,
           target_category = COALESCE($6::jsonb, target_category), updated_at = $4
       WHERE id = $1 AND workspace_id = $2 AND state = 'requested'
       RETURNING *`,
      [input.id, input.workspaceId, input.actorId, input.at, input.paidOverrideReason ?? null,
        input.targetCategory ? JSON.stringify(input.targetCategory) : null],
      this.queryClient,
    );
    return rows[0] ? this.map(rows[0]) : this.findByIdForWorkspace(input.id, input.workspaceId);
  }

  async claimApproved(id: string, workspaceId: string, at: Date): Promise<CategoryCorrectionOperation | null> {
    const { rows } = await query<OperationRow>(
      `UPDATE category_correction_operations SET state = 'executing', updated_at = $3
       WHERE id = $1 AND workspace_id = $2 AND state = 'approved' RETURNING *`,
      [id, workspaceId, at],
      this.queryClient,
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  async releaseToApproved(id: string, workspaceId: string, result: Record<string, unknown>, at: Date): Promise<CategoryCorrectionOperation | null> {
    const { rows } = await query<OperationRow>(
      `UPDATE category_correction_operations
       SET state = 'approved', result = $3, updated_at = $4
       WHERE id = $1 AND workspace_id = $2 AND state = 'executing' RETURNING *`,
      [id, workspaceId, JSON.stringify(result), at],
      this.queryClient,
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  async markExecuted(id: string, workspaceId: string, result: Record<string, unknown>, at: Date): Promise<CategoryCorrectionOperation | null> {
    return this.finish(id, workspaceId, 'executed', result, at);
  }

  async markFailed(id: string, workspaceId: string, result: Record<string, unknown>, at: Date): Promise<CategoryCorrectionOperation | null> {
    return this.finish(id, workspaceId, 'failed', result, at);
  }

  private async insert(operation: CategoryCorrectionOperation, client?: PoolClient): Promise<void> {
    await query(
      `INSERT INTO category_correction_operations
       (id, workspace_id, recommendation_event_id, listing_id, marketplace_id, kind, state,
        target_category, paid_override_reason, requested_by, approved_by, result,
        requested_at, approved_at, executed_at, failed_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT DO NOTHING`,
      [operation.id, operation.workspaceId, operation.recommendationEventId, operation.listingId,
        operation.marketplaceId, operation.kind, operation.state,
        operation.targetCategory ? JSON.stringify(operation.targetCategory) : null,
        operation.paidOverrideReason, operation.requestedBy, operation.approvedBy,
        operation.result ? JSON.stringify(operation.result) : null, operation.requestedAt,
        operation.approvedAt, operation.executedAt, operation.failedAt, operation.updatedAt],
      client ?? this.queryClient,
    );
  }

  private async finish(id: string, workspaceId: string, state: 'executed' | 'failed', result: Record<string, unknown>, at: Date): Promise<CategoryCorrectionOperation | null> {
    const terminalColumn = state === 'executed' ? 'executed_at' : 'failed_at';
    const { rows } = await query<OperationRow>(
      `UPDATE category_correction_operations SET state = $3, result = $4, ${terminalColumn} = $5, updated_at = $5
       WHERE id = $1 AND workspace_id = $2 AND state = 'executing' RETURNING *`,
      [id, workspaceId, state, JSON.stringify(result), at],
      this.queryClient,
    );
    return rows[0] ? this.map(rows[0]) : this.findByIdForWorkspace(id, workspaceId);
  }

  private map(row: OperationRow): CategoryCorrectionOperation {
    return {
      id: row.id, workspaceId: row.workspace_id, recommendationEventId: row.recommendation_event_id,
      listingId: row.listing_id, marketplaceId: row.marketplace_id, kind: row.kind, state: row.state,
      targetCategory: row.target_category, paidOverrideReason: row.paid_override_reason,
      requestedBy: row.requested_by, approvedBy: row.approved_by, result: row.result,
      requestedAt: new Date(row.requested_at), approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      executedAt: row.executed_at ? new Date(row.executed_at) : null,
      failedAt: row.failed_at ? new Date(row.failed_at) : null, updatedAt: new Date(row.updated_at),
    };
  }
}
