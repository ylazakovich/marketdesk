import { resolveTopBarRoute } from './TopBar.js';
import { NAV_ITEMS } from '../../utils/constants.js';

describe('canonical MarketDesk shell contract', () => {
  it.each([
    ['/', 'Dashboard'],
    ['/products', 'Products'],
    ['/analytics', 'Analytics'],
    ['/hermes', 'Hermes AI'],
    ['/marketplaces', 'Marketplaces'],
    ['/settings', 'Settings'],
  ])('maps %s to the contextual title %s', (path, title) => {
    expect(resolveTopBarRoute(path).title).toBe(title);
  });

  it('uses a stable product-detail identity for dynamic product routes', () => {
    expect(resolveTopBarRoute('/products/product-123')).toEqual({
      title: 'Product detail',
      subtitle: 'Listing status, pricing, and marketplace activity.',
    });
  });

  it('keeps Listings routable but out of primary PRD navigation', () => {
    expect(NAV_ITEMS.map(({ path }) => path)).toEqual([
      '/',
      '/products',
      '/analytics',
      '/hermes',
      '/marketplaces',
      '/settings',
    ]);
  });

  it('falls back to the product brand for unknown routes', () => {
    expect(resolveTopBarRoute('/unexpected')).toEqual({
      title: 'MarketDesk',
      subtitle: 'Marketplace operations workspace.',
    });
  });
});
