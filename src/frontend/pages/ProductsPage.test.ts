import { shouldBlockProductWizardNavigation } from './ProductsPage';

describe('product wizard navigation guard', () => {
  it('blocks Back and cross-page navigation while a dirty wizard is open', () => {
    expect(
      shouldBlockProductWizardNavigation(true, true, false, '/products?newProduct=1', '/products')
    ).toBe(true);
    expect(
      shouldBlockProductWizardNavigation(true, true, false, '/products?newProduct=1', '/settings')
    ).toBe(true);
  });

  it('allows the explicit leave decision and clean navigation', () => {
    expect(
      shouldBlockProductWizardNavigation(true, true, true, '/products?newProduct=1', '/settings')
    ).toBe(false);
    expect(
      shouldBlockProductWizardNavigation(true, false, false, '/products?newProduct=1', '/settings')
    ).toBe(false);
  });

  it('does not block a no-op navigation', () => {
    expect(
      shouldBlockProductWizardNavigation(
        true,
        true,
        false,
        '/products?newProduct=1',
        '/products?newProduct=1'
      )
    ).toBe(false);
  });
});
