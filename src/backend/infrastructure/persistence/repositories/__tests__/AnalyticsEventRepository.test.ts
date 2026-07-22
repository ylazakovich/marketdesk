import type { Pool } from 'pg';
import { AnalyticsEventRepository } from '../AnalyticsEventRepository';

describe('AnalyticsEventRepository', () => {
  it('binds range and marketplace queries to the workspace', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{
      id: 'event-1', workspace_id: 'ws-1', listing_id: 'listing-1', marketplace_id: 'marketplace-1',
      event_type: 'sale', quantity: '2', amount: '200.00', cost_at_sale: '50.00',
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
    expect(query.mock.calls[0][0]).toContain('l.marketplace_id = $4');
    expect(result[0]).toMatchObject({
      workspaceId: 'ws-1', marketplaceId: 'marketplace-1', eventType: 'sale',
      quantity: 2, amount: 200, costAtSale: 50,
    });
  });
});
