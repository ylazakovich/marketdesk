import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Product } from '@shared/types';
import { ProductsCards, ProductsTable } from './ProductsTable';

const product: Product = {
  id: 'p-1',
  workspaceId: 'w-1',
  sku: 'SKU-100',
  name: 'Wireless Headphones',
  description: 'Description',
  costPrice: 100,
  sellingPrice: 250,
  condition: 'new',
  category: 'Audio',
  status: 'active',
  tags: ['audio', 'featured'],
  images: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

describe('ProductsTable catalogue hierarchy', () => {
  it('renders product identity, fallback, price/profit/margin/tags and honest marketplace absence', () => {
    const html = renderToStaticMarkup(
      <ProductsTable products={[product]} currency="PLN" selectedIds={new Set(['p-1'])} />
    );
    expect(html).toContain('Wireless Headphones');
    expect(html).toContain('SKU-100');
    expect(html).toContain('WH');
    expect(html).toContain('150');
    expect(html).toContain('60.0% margin');
    expect(html).toContain('featured');
    expect(html).toContain('Marketplace count unavailable');
    expect(html).toContain('Select all products on this page');
  });

  it('distinguishes an empty catalogue from an empty filtered result', () => {
    const empty = renderToStaticMarkup(<ProductsTable products={[]} />);
    const filtered = renderToStaticMarkup(
      <ProductsTable
        products={[]}
        emptyFiltered
        clearFiltersAction={<button>Clear filters</button>}
      />
    );
    expect(empty).toContain('Your catalogue is empty');
    expect(empty).not.toContain('No products match');
    expect(filtered).toContain('No products match');
    expect(filtered).toContain('Clear filters');
  });

  it('keeps cost, price, profit, tags, updated date and edit action in card view', () => {
    const html = renderToStaticMarkup(
      <ProductsCards products={[product]} currency="PLN" onEdit={() => undefined} />
    );
    expect(html).toContain('Wireless Headphones');
    expect(html).toContain('Cost');
    expect(html).toContain('100.00');
    expect(html).toContain('60.0% margin');
    expect(html).toContain('Updated');
    expect(html).toContain('Edit Wireless Headphones');
    expect(html).toContain('Marketplace count unavailable');
  });
});
