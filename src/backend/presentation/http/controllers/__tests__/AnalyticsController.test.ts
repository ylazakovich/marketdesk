import type { Request, Response } from 'express';
import type { AnalyticsApplicationService } from '../../../../application/services/AnalyticsApplicationService';
import { AnalyticsController, parseAnalyticsRange } from '../AnalyticsController';

describe('parseAnalyticsRange', () => {
  it('treats date-only `to` as an inclusive calendar day and preserves global filters', () => {
    expect(parseAnalyticsRange({
      from: '2026-07-01', to: '2026-07-10', marketplaceId: 'marketplace-1', interval: 'week',
    })).toEqual({
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-07-11T00:00:00.000Z'),
      marketplaceId: 'marketplace-1', interval: 'week',
    });
  });

  it.each([
    [{ from: 'invalid' }],
    [{ from: '2026-02-30' }],
    [{ from: ['2026-07-01', '2026-07-02'] }],
    [{ from: '2026-07-10', to: '2026-07-01' }],
    [{ from: '2020-01-01', to: '2026-01-01' }],
    [{ interval: 'hour' }],
  ])('rejects an invalid analytics query %#', (query) => {
    expect(() => parseAnalyticsRange(query as never, new Date('2026-07-11T00:00:00Z')))
      .toThrow(/Analytics/);
  });
});

describe('AnalyticsController handlers', () => {
  const query = { from: '2026-07-01', to: '2026-07-10', marketplaceId: 'marketplace-1' };
  const range = {
    from: new Date('2026-07-01T00:00:00.000Z'),
    to: new Date('2026-07-11T00:00:00.000Z'),
    marketplaceId: 'marketplace-1', interval: undefined,
  };

  it.each([
    ['overview', 'getDashboardMetrics'],
    ['revenue', 'getRevenue'],
    ['listings', 'getListingPerformance'],
  ] as const)('passes workspace and parsed range through %s', async (handler, serviceMethod) => {
    const result = { marker: handler };
    const service = {
      getDashboardMetrics: jest.fn(), getRevenue: jest.fn(), getListingPerformance: jest.fn(),
    };
    service[serviceMethod].mockResolvedValue(result);
    const status = jest.fn();
    const json = jest.fn();
    status.mockReturnValue({ json });
    const req = { query, user: { workspaceId: 'ws-1' } } as unknown as Request;
    const res = { status } as unknown as Response;

    const controller = new AnalyticsController(service as unknown as AnalyticsApplicationService);
    await controller[handler](req, res);

    expect(service[serviceMethod]).toHaveBeenCalledWith('ws-1', range);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ success: true, data: result });
  });
});
