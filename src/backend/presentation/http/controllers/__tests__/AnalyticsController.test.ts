import { parseAnalyticsRange } from '../AnalyticsController';

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
    [{ from: '2026-07-10', to: '2026-07-01' }],
    [{ from: '2020-01-01', to: '2026-01-01' }],
    [{ interval: 'hour' }],
  ])('rejects an invalid analytics query %#', (query) => {
    expect(() => parseAnalyticsRange(query as never, new Date('2026-07-11T00:00:00Z')))
      .toThrow(/Analytics/);
  });
});
