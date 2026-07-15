import { buildViewsChartData, formatListingChartLabel } from './ViewsChart';
import type { ListingPerformance } from '../../state/api/index.js';

function listing(overrides: Partial<ListingPerformance> = {}): ListingPerformance {
  return {
    listingId: 'listing-1',
    productId: 'fe1058c9-d577-4efb-bb0c-35fc1853b180',
    productName: 'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan',
    productSku: 'AIRPODS4-PL-001',
    marketplaceId: 'marketplace-olx',
    marketplaceName: 'OLX',
    marketplaceListingId: '1085426829',
    status: 'live',
    price: 399,
    views: 2,
    watchers: 0,
    messages: 0,
    ...overrides,
  };
}

describe('formatListingChartLabel', () => {
  it('uses readable product metadata instead of the internal UUID as primary chart label', () => {
    const label = formatListingChartLabel(listing());

    expect(label).toBe(
      'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan (AIRPODS4-PL-001 · OLX · 1085426829)',
    );
    expect(label).not.toContain('fe1058c9-d577-4efb-bb0c-35fc1853b180');
  });

  it('falls back to the marketplace listing id before showing a generic label', () => {
    expect(
      formatListingChartLabel(
        listing({ productName: null, productSku: null, marketplaceName: null }),
      ),
    ).toBe('1085426829');
    expect(formatListingChartLabel(listing({ productName: null, marketplaceListingId: null }))).toBe(
      'Untitled listing (AIRPODS4-PL-001 · OLX)',
    );
  });
});

describe('buildViewsChartData', () => {
  it('uses readable labels in the chart data transformation and preserves top-view sorting', () => {
    const rows = buildViewsChartData(
      [
        listing({ listingId: 'low', productName: 'Low views item', views: 1 }),
        listing({ listingId: 'high', productName: 'High views item', views: 7 }),
      ],
      1,
    );

    expect(rows).toEqual([
      {
        label: 'High views item (AIRPODS4-PL-001 · OLX · 1085426829)',
        views: 7,
      },
    ]);
    expect(rows[0].label).not.toContain('fe1058c9-d577-4efb-bb0c-35fc1853b180');
  });
});
