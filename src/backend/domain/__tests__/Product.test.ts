import { Product, CreateProductProps } from '../entities/Product';
import { unwrap, money } from '../testkit/support';
import type { ProductCategorySource } from '../../../shared/types';

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

  it('does not accept marketplace provenance through ordinary creation', () => {
    const product = unwrap(Product.create({
      ...baseProps(),
      categoryProvenance: { status: 'synced', sources: [] },
    } as CreateProductProps & { categoryProvenance: unknown }));
    expect(product.categoryProvenance).toBeNull();
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

  it('rejects sellingPrice below costPrice without explicit confirmation', () => {
    const r = Product.create(baseProps({ costPrice: money(80), sellingPrice: money(50) }));
    expect(r.isErr()).toBe(true);
  });

  it('accepts below-cost creation with explicit confirmation', () => {
    const r = Product.create(
      baseProps({ costPrice: money(80), sellingPrice: money(50), allowBelowCost: true }),
    );
    expect(r.isOk()).toBe(true);
  });

  it('allows zero draft prices and selling price equal to cost', () => {
    expect(Product.create(baseProps({ costPrice: money(0), sellingPrice: money(0) })).isOk()).toBe(true);
    expect(Product.create(baseProps({ costPrice: money(50), sellingPrice: money(50) })).isOk()).toBe(true);
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

  it('requires confirmation when cost becomes higher than selling price', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.updateCostPrice(money(90)).isErr()).toBe(true);
    expect(product.updateCostPrice(money(90), true).isOk()).toBe(true);
    expect(product.costPrice.amount).toBeCloseTo(90);
  });

  it('rejects updating selling price below cost without confirmation', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.updateSellingPrice(money(10)).isErr()).toBe(true);
    expect(product.sellingPrice.amount).toBeCloseTo(80);
  });

  it('accepts explicit confirmation on below-cost updates', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.updateSellingPrice(money(10), true).isOk()).toBe(true);
    expect(product.sellingPrice.amount).toBeCloseTo(10);
  });

  it('accepts equal-to-cost update boundaries without confirmation', () => {
    const sellingUpdate = unwrap(Product.create(baseProps()));
    expect(sellingUpdate.updateSellingPrice(money(50)).isOk()).toBe(true);
    expect(sellingUpdate.sellingPrice.amount).toBeCloseTo(50);

    const costUpdate = unwrap(Product.create(baseProps()));
    expect(costUpdate.updateCostPrice(money(80)).isOk()).toBe(true);
    expect(costUpdate.costPrice?.amount).toBeCloseTo(80);
  });

  it('validates description length on update', () => {
    const product = unwrap(Product.create(baseProps()));
    expect(product.updateDescription('short').isErr()).toBe(true);
  });
});

describe('Product category provenance', () => {
  const source = (overrides: Partial<ProductCategorySource> = {}): ProductCategorySource => ({
    marketplaceKey: 'olx', marketplaceId: 'm1', listingId: 'l1',
    providerCategoryId: '100', name: 'Projectors', path: ['Electronics', 'Projectors'],
    taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
    syncedAt: '2026-07-15T01:00:00.000Z',
    ...overrides,
  });

  it('refreshes provenance timestamps without reporting a category change', () => {
    const product = unwrap(Product.create(baseProps({ category: 'Projectors' })));
    unwrap(product.synchronizeCategory('Projectors', [source()]));

    const result = unwrap(product.synchronizeCategory('Projectors', [source({
      taxonomyVerifiedAt: '2026-07-16T00:00:00.000Z',
      syncedAt: '2026-07-16T01:00:00.000Z',
    })]));

    expect(result).toEqual({ categoryChanged: false, stateChanged: true });
    expect(product.categoryProvenance).toMatchObject({
      status: 'synced',
      sources: [expect.objectContaining({
        taxonomyVerifiedAt: '2026-07-16T00:00:00.000Z',
        syncedAt: '2026-07-16T01:00:00.000Z',
      })],
    });
  });

  it('refreshes stable conflict evidence without creating a new conflict transition', () => {
    const product = unwrap(Product.create(baseProps({ category: 'Projectors' })));
    const other = source({
      listingId: 'l2', providerCategoryId: '200', name: 'Audio', path: ['Electronics', 'Audio'],
    });
    unwrap(product.synchronizeCategory('Projectors', [source()]));
    expect(product.recordCategoryConflict([source(), other], new Date('2026-07-15T02:00:00.000Z')))
      .toEqual({ stateChanged: true, conflictChanged: true });

    const refreshed = [source({
      taxonomyVerifiedAt: '2026-07-16T00:00:00.000Z', syncedAt: '2026-07-16T01:00:00.000Z',
    }), {
      ...other,
      taxonomyVerifiedAt: '2026-07-16T00:00:00.000Z', syncedAt: '2026-07-16T01:00:00.000Z',
    }];
    expect(product.recordCategoryConflict(refreshed, new Date('2026-07-16T02:00:00.000Z')))
      .toEqual({ stateChanged: true, conflictChanged: false });
    expect(product.categoryProvenance).toMatchObject({
      status: 'conflict',
      detectedAt: '2026-07-15T02:00:00.000Z',
      currentSources: [expect.objectContaining({ syncedAt: '2026-07-16T01:00:00.000Z' })],
      candidates: [
        expect.objectContaining({ syncedAt: '2026-07-16T01:00:00.000Z' }),
        expect.objectContaining({ syncedAt: '2026-07-16T01:00:00.000Z' }),
      ],
    });
    expect(product.recordCategoryConflict(refreshed, new Date('2026-07-17T02:00:00.000Z')))
      .toEqual({ stateChanged: false, conflictChanged: false });
  });

  it('preserves provenance and updatedAt when an ordinary edit resubmits the same category', () => {
    const product = unwrap(Product.create(baseProps({ category: 'Projectors' })));
    unwrap(product.synchronizeCategory('Projectors', [source()]));
    const provenance = product.categoryProvenance;
    const updatedAt = product.updatedAt;

    unwrap(product.updateCategory(' Projectors '));

    expect(product.categoryProvenance).toEqual(provenance);
    expect(product.updatedAt).toBe(updatedAt);
  });

  it('marks category persistence intent only for category or provenance mutations', () => {
    const product = unwrap(Product.create(baseProps({ category: 'Projectors' })));
    expect(product.hasCategoryStateChanges).toBe(true);
    product.markCategoryStatePersisted();

    unwrap(product.rename('Updated projector'));
    expect(product.hasCategoryStateChanges).toBe(false);

    unwrap(product.updateCategory('Audio'));
    expect(product.hasCategoryStateChanges).toBe(true);
    product.markCategoryStatePersisted();

    unwrap(product.synchronizeCategory('Audio', [source()]));
    expect(product.hasCategoryStateChanges).toBe(true);
  });
});
