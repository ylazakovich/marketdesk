import type { Pool, PoolClient } from 'pg';
import { query as mockedQuery } from '../../../../config/database';
import { CategoryCorrectionOperationRepository } from '../CategoryCorrectionOperationRepository';
import type { CategoryCorrectionOperation } from '../../../../domain/repositories/interfaces/ICategoryCorrectionOperationRepository';

jest.mock('../../../../config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

function operation(overrides: Partial<CategoryCorrectionOperation>): CategoryCorrectionOperation {
  const now = new Date('2026-07-16T00:00:00.000Z');
  return {
    id: overrides.id ?? 'op-1',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    recommendationEventId: overrides.recommendationEventId === undefined
      ? 'event-1'
      : overrides.recommendationEventId,
    listingId: overrides.listingId ?? 'listing-1',
    marketplaceId: overrides.marketplaceId ?? 'marketplace-1',
    kind: overrides.kind ?? 'delist',
    state: overrides.state ?? 'requested',
    targetCategory: overrides.targetCategory ?? null,
    paidOverrideReason: overrides.paidOverrideReason ?? null,
    requestedBy: overrides.requestedBy ?? 'user-1',
    approvedBy: overrides.approvedBy ?? null,
    result: overrides.result ?? null,
    requestedAt: overrides.requestedAt ?? now,
    approvedAt: overrides.approvedAt ?? null,
    executedAt: overrides.executedAt ?? null,
    failedAt: overrides.failedAt ?? null,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function mapRow(op: CategoryCorrectionOperation) {
  return {
    id: op.id,
    workspace_id: op.workspaceId,
    recommendation_event_id: op.recommendationEventId,
    listing_id: op.listingId,
    marketplace_id: op.marketplaceId,
    kind: op.kind,
    state: op.state,
    target_category: op.targetCategory,
    paid_override_reason: op.paidOverrideReason,
    requested_by: op.requestedBy,
    approved_by: op.approvedBy,
    result: op.result,
    requested_at: op.requestedAt,
    approved_at: op.approvedAt,
    executed_at: op.executedAt,
    failed_at: op.failedAt,
    updated_at: op.updatedAt,
  };
}

function makePoolWithClient() {
  const client = {
    query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
    release: jest.fn(),
  };
  const pool = {
    connect: jest.fn(async () => client),
  } as unknown as Pool;
  return { pool, client } as { pool: Pool; client: PoolClient & { query: jest.Mock } };
}

describe('CategoryCorrectionOperationRepository', () => {
  beforeEach(() => {
    (mockedQuery as jest.Mock).mockReset();
  });

  it('reuses an existing operation only when immutable binding fields match', async () => {
    const repo = new CategoryCorrectionOperationRepository();
    const existing = operation({ id: 'op-1', marketplaceId: 'marketplace-1', kind: 'delist' });

    (mockedQuery as jest.Mock).mockResolvedValue({
      rows: [mapRow(existing)],
      rowCount: 1,
    });

    const result = await repo.create(operation({ id: 'op-1' }));

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ id: existing.id, kind: 'delist', listingId: existing.listingId });
  });

  it('rejects create when immutable bindings do not match an existing operation id', async () => {
    const repo = new CategoryCorrectionOperationRepository();
    const existing = operation({
      id: 'op-1',
      workspaceId: 'ws-1',
      marketplaceId: 'marketplace-1',
      listingId: 'listing-1',
      recommendationEventId: 'event-1',
      kind: 'recreate',
    });

    (mockedQuery as jest.Mock).mockResolvedValue({
      rows: [mapRow(existing)],
      rowCount: 1,
    });

    await expect(repo.create(operation({ id: 'op-1', kind: 'delist' }))).rejects.toThrow(
      'Category correction operation ID is already bound to another action',
    );
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects create when mutable workspace/listing/marketplace/recommendation bindings differ', async () => {
    const repo = new CategoryCorrectionOperationRepository();
    const existing = operation({
      id: 'op-1',
      workspaceId: 'ws-1',
      listingId: 'listing-1',
      marketplaceId: 'marketplace-1',
      recommendationEventId: 'event-1',
      kind: 'delist',
    });
    (mockedQuery as jest.Mock).mockResolvedValue({
      rows: [mapRow(existing)],
      rowCount: 1,
    });

    await expect(repo.create(operation({
      id: 'op-1',
      workspaceId: 'ws-2',
      listingId: 'listing-1',
      marketplaceId: 'marketplace-1',
      recommendationEventId: 'event-1',
      kind: 'delist',
    }))).rejects.toThrow('already bound to another action');
    await expect(repo.create(operation({
      id: 'op-1',
      workspaceId: 'ws-1',
      listingId: 'listing-2',
      marketplaceId: 'marketplace-1',
      recommendationEventId: 'event-1',
      kind: 'delist',
    }))).rejects.toThrow('already bound to another action');
    await expect(repo.create(operation({
      id: 'op-1',
      workspaceId: 'ws-1',
      listingId: 'listing-1',
      marketplaceId: 'marketplace-2',
      recommendationEventId: 'event-1',
      kind: 'delist',
    }))).rejects.toThrow('already bound to another action');
    await expect(repo.create(operation({
      id: 'op-1',
      workspaceId: 'ws-1',
      listingId: 'listing-1',
      marketplaceId: 'marketplace-1',
      recommendationEventId: 'event-2',
      kind: 'delist',
    }))).rejects.toThrow('already bound to another action');
  });

  it('creates a pair as an atomic transactional unit', async () => {
    const { pool, client } = makePoolWithClient();
    const repo = new CategoryCorrectionOperationRepository(pool);
    const delist = operation({ id: 'delist-1', kind: 'delist', recommendationEventId: 'event-1', listingId: 'listing-1' });
    const recreate = operation({ id: 'recreate-1', kind: 'recreate', recommendationEventId: 'event-1', listingId: 'listing-1' });

    (mockedQuery as jest.Mock)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [mapRow(delist)], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [mapRow(recreate)], rowCount: 1 });

    await repo.createPair(delist, recreate);

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(mockedQuery).toHaveBeenCalledTimes(6);
  });

  it('rolls back pair creation when one half conflicts with a mismatched binding', async () => {
    const { pool, client } = makePoolWithClient();
    const repo = new CategoryCorrectionOperationRepository(pool);
    const delist = operation({ id: 'delist-1', kind: 'delist', recommendationEventId: 'event-1', listingId: 'listing-1' });
    const recreate = operation({ id: 'recreate-1', kind: 'recreate', recommendationEventId: 'event-1', listingId: 'listing-1' });
    const stale = operation({ id: 'recreate-1', kind: 'recreate', recommendationEventId: 'other-event', listingId: 'listing-1' });

    (mockedQuery as jest.Mock)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [mapRow(delist)], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [mapRow(stale)], rowCount: 1 });

    await expect(repo.createPair(delist, recreate)).rejects.toThrow('Category correction operation ID is already bound to another action');

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mockedQuery).toHaveBeenCalledTimes(4);
  });

  it('keeps an existing pair idempotent when both operations already match', async () => {
    const { pool, client } = makePoolWithClient();
    const repo = new CategoryCorrectionOperationRepository(pool);
    const delist = operation({ id: 'delist-1', kind: 'delist', recommendationEventId: 'event-1', listingId: 'listing-1' });
    const recreate = operation({ id: 'recreate-1', kind: 'recreate', recommendationEventId: 'event-1', listingId: 'listing-1' });

    (mockedQuery as jest.Mock)
      .mockResolvedValueOnce({ rows: [mapRow(delist)], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [mapRow(recreate)], rowCount: 1 });

    await repo.createPair(delist, recreate);

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed pair descriptors before any persistence writes', async () => {
    const { pool, client } = makePoolWithClient();
    const repo = new CategoryCorrectionOperationRepository(pool);
    const delist = operation({
      id: 'delist-1',
      kind: 'delist',
      workspaceId: 'ws-1',
      listingId: 'listing-1',
      marketplaceId: 'marketplace-1',
      recommendationEventId: 'event-1',
    });
    const recreate = operation({
      id: 'recreate-1',
      kind: 'recreate',
      workspaceId: 'ws-2',
      listingId: 'listing-1',
      marketplaceId: 'marketplace-1',
      recommendationEventId: 'event-1',
    });

    await expect(repo.createPair(delist, recreate)).rejects.toThrow(
      'Category correction pair must share recommendation, listing, workspace, and marketplace',
    );

    expect(client.query).not.toHaveBeenCalled();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('rejects pair attempts where operation kinds are not delist/recreate', async () => {
    const { pool, client } = makePoolWithClient();
    const repo = new CategoryCorrectionOperationRepository(pool);
    const delist = operation({
      id: 'delist-1',
      kind: 'recreate',
      recommendationEventId: 'event-1',
      listingId: 'listing-1',
      workspaceId: 'ws-1',
      marketplaceId: 'marketplace-1',
    });
    const recreate = operation({
      id: 'recreate-1',
      kind: 'recreate',
      recommendationEventId: 'event-1',
      listingId: 'listing-1',
      workspaceId: 'ws-1',
      marketplaceId: 'marketplace-1',
    });

    await expect(repo.createPair(delist, recreate)).rejects.toThrow(
      'Category correction pair must contain one delist and one recreate operation',
    );

    expect(client.query).not.toHaveBeenCalled();
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
