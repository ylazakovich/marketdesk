import type { PoolClient, Pool } from 'pg';
import { query, withTransaction } from '../../../config/database';
import type { IEventRepository } from '../../../domain/repositories/interfaces/IEventRepository';
import type { HermesEvent } from '../../../domain/entities/HermesEvent';
import type { HermesEventStatus } from '../../../../shared/types';
import { EventMapper } from '../mappers/EventMapper';
import type { HermesEventRow } from '../mappers/rows';
import type { AgentRecommendationRecord } from '../../../domain/agents/MarketDeskAgentCatalog';

const EVENT_SELECT = `
  SELECT id, workspace_id, product_id, type, severity, status, title, detail,
         proposed_change, autonomy_decision, created_at, resolved_at
  FROM hermes_events
`;

const AGENT_RECOMMENDATION_TIMESTAMP_COLUMNS = new Set([
  'approved_at',
  'dismissed_at',
  'applied_at',
] as const);

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

  async saveRecommendationIfAbsent(event: HermesEvent, idempotencyKey: string): Promise<boolean> {
    const proposedChange = event.proposedChange === null ? null : JSON.stringify(event.proposedChange);
    const { rowCount } = await query(
      `INSERT INTO hermes_events
         (id, workspace_id, product_id, type, severity, status, title, detail,
          proposed_change, autonomy_decision, created_at, resolved_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [event.id, event.workspaceId, event.productId, event.type, event.severity, event.status,
        event.title, event.detail, proposedChange, event.autonomyDecision, event.createdAt,
        event.resolvedAt, idempotencyKey],
      this.queryClient,
    );
    return rowCount === 1;
  }

  async saveAgentRecommendationIfAbsent(
    event: HermesEvent,
    idempotencyKey: string,
    recommendation: AgentRecommendationRecord,
  ): Promise<boolean> {
    const run = async (client: PoolClient): Promise<boolean> => {
      const proposedChange = event.proposedChange === null ? null : JSON.stringify(event.proposedChange);
      const { rowCount } = await query(
        `INSERT INTO hermes_events
           (id, workspace_id, product_id, type, severity, status, title, detail,
            proposed_change, autonomy_decision, created_at, resolved_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [event.id, event.workspaceId, event.productId, event.type, event.severity, event.status,
          event.title, event.detail, proposedChange, event.autonomyDecision, event.createdAt,
          event.resolvedAt, idempotencyKey],
        client,
      );
      if (rowCount !== 1) return false;
      await this.insertAgentRecommendation(recommendation, client);
      return true;
    };

    if (this.client) return run(this.client);
    return withTransaction(run);
  }

  async hasRecentAgentRecommendation(
    workspaceId: string,
    productId: string,
    agentId: 'listing-seo',
    agentVersion: string,
    sourceFingerprint: string,
    recommendationFingerprint: string,
    since: Date,
  ): Promise<boolean> {
    const { rows } = await query<{ found: number }>(
      `SELECT 1 AS found
         FROM hermes_agent_recommendations
        WHERE workspace_id = $1
          AND product_id = $2
          AND agent_id = $3
          AND agent_version = $4
          AND source_fingerprint = $5
          AND recommendation_fingerprint = $6
          AND outcome = 'suggested'
          AND suggested_at >= $7
        LIMIT 1`,
      [workspaceId, productId, agentId, agentVersion, sourceFingerprint, recommendationFingerprint, since],
      this.queryClient,
    );
    return rows.length > 0;
  }

  async recordAgentRecommendationOutcome(recommendation: AgentRecommendationRecord): Promise<void> {
    await this.insertAgentRecommendation(recommendation, this.queryClient);
  }

  async findAgentRecommendationByEvent(
    workspaceId: string,
    eventId: string,
  ): Promise<AgentRecommendationRecord | null> {
    const { rows } = await query<{
      id: string;
      workspace_id: string;
      product_id: string;
      event_id: string | null;
      agent_id: 'listing-seo';
      agent_version: string;
      creativity_preset: AgentRecommendationRecord['creativityPreset'];
      source_fingerprint: string;
      recommendation_fingerprint: string;
      outcome: AgentRecommendationRecord['outcome'];
      suggested_at: Date;
      approved_at: Date | null;
      dismissed_at: Date | null;
      applied_at: Date | null;
      failed_at: Date | null;
    }>(
      `SELECT id, workspace_id, product_id, event_id, agent_id, agent_version, creativity_preset,
              source_fingerprint, recommendation_fingerprint, outcome, suggested_at,
              approved_at, dismissed_at, applied_at, failed_at
         FROM hermes_agent_recommendations
        WHERE workspace_id = $1 AND event_id = $2
        LIMIT 1`,
      [workspaceId, eventId],
      this.queryClient,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      productId: row.product_id,
      eventId: row.event_id,
      agentId: row.agent_id,
      agentVersion: row.agent_version,
      creativityPreset: row.creativity_preset,
      sourceFingerprint: row.source_fingerprint,
      recommendationFingerprint: row.recommendation_fingerprint,
      outcome: row.outcome,
      suggestedAt: row.suggested_at,
      approvedAt: row.approved_at ?? undefined,
      dismissedAt: row.dismissed_at ?? undefined,
      appliedAt: row.applied_at ?? undefined,
      failedAt: row.failed_at ?? undefined,
    };
  }

  async markAgentRecommendationApproved(workspaceId: string, eventId: string, at: Date): Promise<void> {
    await this.updateAgentRecommendationTimestamp(workspaceId, eventId, 'approved_at', at);
  }

  async markAgentRecommendationDismissed(workspaceId: string, eventId: string, at: Date): Promise<void> {
    await this.updateAgentRecommendationTimestamp(workspaceId, eventId, 'dismissed_at', at);
  }

  async markAgentRecommendationApplied(workspaceId: string, eventId: string, at: Date): Promise<void> {
    await this.updateAgentRecommendationTimestamp(workspaceId, eventId, 'applied_at', at);
  }

  async markAgentRecommendationFailed(workspaceId: string, eventId: string, at: Date): Promise<void> {
    await query(
      `UPDATE hermes_agent_recommendations
          SET outcome = 'failed', failed_at = $3
        WHERE workspace_id = $1 AND event_id = $2`,
      [workspaceId, eventId, at],
      this.queryClient,
    );
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
      `DELETE FROM hermes_events AS event
       WHERE event.created_at < $1
         AND NOT EXISTS (
           SELECT 1 FROM category_correction_operations AS operation
            WHERE operation.recommendation_event_id = event.id
         )`,
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

  private async insertAgentRecommendation(
    recommendation: AgentRecommendationRecord,
    client?: PoolClient | Pool,
  ): Promise<void> {
    await query(
      `INSERT INTO hermes_agent_recommendations
         (id, workspace_id, product_id, event_id, agent_id, agent_version, creativity_preset,
          source_fingerprint, recommendation_fingerprint, outcome, suggested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        recommendation.id,
        recommendation.workspaceId,
        recommendation.productId,
        recommendation.eventId ?? null,
        recommendation.agentId,
        recommendation.agentVersion,
        recommendation.creativityPreset,
        recommendation.sourceFingerprint,
        recommendation.recommendationFingerprint,
        recommendation.outcome,
        recommendation.suggestedAt,
      ],
      client,
    );
  }

  private async updateAgentRecommendationTimestamp(
    workspaceId: string,
    eventId: string,
    column: 'approved_at' | 'dismissed_at' | 'applied_at',
    at: Date,
  ): Promise<void> {
    if (!AGENT_RECOMMENDATION_TIMESTAMP_COLUMNS.has(column)) {
      throw new Error(`Unsupported agent recommendation timestamp column: ${column}`);
    }
    await query(
      `UPDATE hermes_agent_recommendations SET ${column} = $3 WHERE workspace_id = $1 AND event_id = $2`,
      [workspaceId, eventId, at],
      this.queryClient,
    );
  }
}
