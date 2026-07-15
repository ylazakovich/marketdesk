import { Product, CreateProductProps } from '../entities/Product';
import { unwrap, money } from '../testkit/support';

function baseProps(overrides: Partial<CreateProductProps> = {}): CreateProductProps {
  return {
    id: 'p1',
    workspaceId: 'w1',
    sku: 'SKU-1',
    name: 'Widget',
    description: 'A perfectly reasonable description over twenty chars.',
    costPrice: money(50),
    sellingPrice: money(80),
    condition: 'new',
    category: 'electronics',
    ...overrides,
  };
}

describe('Product invariants', () => {
  it('creates a valid product with default draft status', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.status).toBe('draft');
    expect(product.sellingPrice.amount).toBeCloseTo(80);
  });

  it('rejects a description shorter than 20 chars', () => {
    const r = Product.create(baseProps({ description: 'too short' }));
    expect(r.isErr()).toBe(true);
  });

  it('rejects a description longer than 2000 chars', () => {
    const r = Product.create(baseProps({ description: 'x'.repeat(2001) }));
    expect(r.isErr()).toBe(true);
  });

  it('rejects a negative selling price', () => {
    const r = Product.create(baseProps({ sellingPrice: money(-1) }));
    expect(r.isErr()).toBe(true);
  });

  it('allows sellingPrice below costPrice as an intentional seller decision', () => {
    const r = Product.create(baseProps({ costPrice: money(80), sellingPrice: money(50) }));
    expect(r.isOk()).toBe(true);
    expect(unwrap(r).sellingPrice.amount).toBeCloseTo(50);
  });

  it('accepts the legacy allowBelowCost flag without changing below-cost behaviour', () => {
    const r = Product.create(
      baseProps({ costPrice: money(80), sellingPrice: money(50), allowBelowCost: true }),
    );
    expect(r.isOk()).toBe(true);
  });
});

describe('Product status transitions (forward-only)', () => {
  it('allows draft -> active -> attention -> sold', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.activate().isOk()).toBe(true);
    expect(product.flagAttention().isOk()).toBe(true);
    expect(product.markSold().isOk()).toBe(true);
    expect(product.status).toBe('sold');
  });

  it('forbids reverse transitions (active -> draft)', () => {
    const product = unwrap(Product.create(baseProps()));
    unwrap(product.activate());
    expect(product.transitionTo('draft').isErr()).toBe(true);
  });

  it('forbids any transition out of sold', () => {
    const product = unwrap(Product.create(baseProps()));
    unwrap(product.markSold());
    expect(product.transitionTo('active').isErr()).toBe(true);
    expect(product.canPublish()).toBe(false);
  });

  it('canPublish is true while not sold', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.canPublish()).toBe(true);
  });
});

describe('Product price / description updates', () => {
  it('updates cost price while preserving currency', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.updateCostPrice(money(45)).isOk()).toBe(true);
    expect(product.costPrice.amount).toBeCloseTo(45);
    expect(product.costPrice.currency).toBe('PLN');
  });

  it('allows updating cost price above the current selling price as below-cost context', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.updateCostPrice(money(90)).isOk()).toBe(true);
    expect(product.costPrice.amount).toBeCloseTo(90);
  });

  it('allows updating selling price below cost', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.updateSellingPrice(money(10)).isOk()).toBe(true);
    expect(product.sellingPrice.amount).toBeCloseTo(10);
  });

  it('accepts the legacy allowBelowCost flag on below-cost updates', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.updateSellingPrice(money(10), true).isOk()).toBe(true);
    expect(product.sellingPrice.amount).toBeCloseTo(10);
  });

  it('validates description length on update', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.updateDescription('short').isErr()).toBe(true);
  });
});
