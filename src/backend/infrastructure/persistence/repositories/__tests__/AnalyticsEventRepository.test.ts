import type { Pool } from 'pg';
import { query as databaseQuery } from '../../../../config/database';
import { AnalyticsEventRepository } from '../AnalyticsEventRepository';

jest.mock('../../../../config/database', () => ({ query: jest.fn() }));

describe('AnalyticsEventRepository', () => {
  it('binds range and marketplace queries to the workspace', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{
      id: 'event-1', workspace_id: 'ws-1', listing_id: 'listing-1', marketplace_id: 'marketplace-1',
      event_type: 'sale', quantity: '2', amount: '200.00', cost_at_sale: '50.00',
      currency: 'PLN',
      occurred_at: '2026-07-05T10:00:00.000Z',
    }] });
    const repository = new AnalyticsEventRepository({ query } as unknown as Pool);
    const result = await repository.findByRange({
      workspaceId: 'ws-1', from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-11T00:00:00Z'), marketplaceId: 'marketplace-1',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('e.workspace_id = $1'), [
      'ws-1', new Date('2026-07-01T00:00:00Z'), new Date('2026-07-11T00:00:00Z'), 'marketplace-1',
    ]);
    expect(query.mock.calls[0][0]).toContain('COALESCE(e.marketplace_id, l.marketplace_id) = $4');
    expect(result[0]).toMatchObject({
      workspaceId: 'ws-1', marketplaceId: 'marketplace-1', eventType: 'sale',
      quantity: 2, amount: 200, costAtSale: 50,
    });
  });

  it('appends events with a deterministic id so retries are idempotent', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new AnalyticsEventRepository({ query } as unknown as Pool);
    const event = {
      idempotencyKey: 'ws-1:sync:view:l-1:42', workspaceId: 'ws-1', listingId: 'l-1',
      marketplaceId: 'marketplace-1', eventType: 'view' as const, quantity: 42,
      amount: null, costAtSale: null, currency: null,
      occurredAt: new Date('2026-07-22T10:00:00Z'),
    };

    await repository.appendMany([event]);
    await repository.appendMany([event]);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (id) DO NOTHING');
    expect(query.mock.calls[0][1][0]).toBe(query.mock.calls[1][1][0]);
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['ws-1', 'l-1', 'view', 42]));
  });

  it('omits the marketplace clause when no marketplace filter is requested', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new AnalyticsEventRepository({ query } as unknown as Pool);
    const from = new Date('2026-07-01T00:00:00Z');
    const to = new Date('2026-07-11T00:00:00Z');

    await repository.findByRange({ workspaceId: 'ws-1', from, to });

    expect(query).toHaveBeenCalledWith(expect.not.stringContaining('= $4'), ['ws-1', from, to]);
  });

  it('uses the shared database query when no client is injected', async () => {
    const sharedQuery = databaseQuery as jest.MockedFunction<typeof databaseQuery>;
    sharedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });
    const repository = new AnalyticsEventRepository();
    const from = new Date('2026-07-01T00:00:00Z');
    const to = new Date('2026-07-11T00:00:00Z');

    await repository.findByRange({ workspaceId: 'ws-1', from, to });

    expect(sharedQuery).toHaveBeenCalledWith(expect.stringContaining('e.workspace_id = $1'), ['ws-1', from, to]);
  });
});
