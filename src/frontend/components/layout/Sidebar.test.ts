import { isPrimaryNavActive, resolveSidebarResponsiveMode } from './Sidebar.js';

// Layout geometry is intentionally tested as a contract because MUI's default
// breakpoints (md=900) do not match the product requirement.
describe('MarketDesk sidebar shell contract', () => {
  it.each([
    [0, 'mobile'],
    [767, 'mobile'],
    [768, 'medium'],
    [1199, 'medium'],
    [1200, 'desktop'],
    [1920, 'desktop'],
  ] as const)('uses the expected responsive mode at %ipx', (width, mode) => {
    expect(resolveSidebarResponsiveMode(width)).toBe(mode);
  });

  it('keeps Products active for catalogue, wizard query, and detail routes', () => {
    expect(isPrimaryNavActive('/products', '/products')).toBe(true);
    expect(isPrimaryNavActive('/products/new', '/products')).toBe(true);
    expect(isPrimaryNavActive('/products/product-123', '/products')).toBe(true);
  });

  it('does not mark Dashboard active for unrelated routes', () => {
    expect(isPrimaryNavActive('/', '/')).toBe(true);
    expect(isPrimaryNavActive('/products', '/')).toBe(false);
  });
});
