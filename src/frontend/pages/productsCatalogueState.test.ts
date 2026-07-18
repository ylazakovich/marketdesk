import type { Product } from '@shared/types';
import {
  hasCatalogueFilters,
  parseProductsCatalogueState,
  productInitials,
  productsToCsv,
  tabStatus,
  updateProductsCatalogueSearch,
} from './productsCatalogueState';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    workspaceId: 'w-1',
    sku: 'SKU,1',
    name: 'Quoted "name"',
    description: 'Description',
    costPrice: 10,
    sellingPrice: 20,
    condition: 'new',
    category: 'Audio',
    status: 'active',
    tags: ['featured', 'audio'],
    images: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('products catalogue URL state', () => {
  it('parses validated state and serializes every catalogue control while preserving wizard state', () => {
    const parsed = parseProductsCatalogueState(
      '?tab=active&search=phone&tags=audio,featured&priceMin=10&priceMax=99&sort=name&page=3&view=card'
    );
    expect(parsed).toEqual({
      tab: 'active',
      search: 'phone',
      tags: ['audio', 'featured'],
      priceMin: '10',
      priceMax: '99',
      sort: 'name',
      page: 2,
      view: 'card',
    });
    expect(updateProductsCatalogueSearch('?newProduct=1', parsed)).toBe(
      '?newProduct=1&tab=active&search=phone&tag=audio&tag=featured&priceMin=10&priceMax=99&sort=name&page=3&view=card'
    );
  });

  it('falls back from invalid URL values and maps tabs to real API statuses', () => {
    expect(
      parseProductsCatalogueState('?tab=deleted&page=-2&sort=profit&view=tiles')
    ).toMatchObject({ tab: 'all', page: 0, sort: '-updatedAt', view: 'list' });
    expect(tabStatus('all')).toBeUndefined();
    expect(tabStatus('attention')).toEqual(['attention']);
  });

  it('detects filters independently from sort/view/page', () => {
    expect(hasCatalogueFilters(parseProductsCatalogueState('?sort=name&view=card&page=2'))).toBe(
      false
    );
    expect(hasCatalogueFilters(parseProductsCatalogueState('?search=chair'))).toBe(true);
  });
});

describe('products catalogue export and identity helpers', () => {
  it('exports selected real fields as escaped CSV', () => {
    const csv = productsToCsv([product()], 'PLN');
    expect(csv).toContain(
      'id,sku,name,status,category,costPrice,sellingPrice,currency,tags,updatedAt'
    );
    expect(csv).toContain('p-1,"SKU,1","Quoted ""name""",active,Audio,10,20,PLN,featured|audio');
  });

  it.each(['=HYPERLINK("https://example.test")', '+cmd', '-1+1', '@SUM(1,1)', '\t=1+1'])(
    'neutralizes spreadsheet formula input %s',
    (name) => {
      const csv = productsToCsv([product({ name })], 'PLN');
      expect(csv).toContain(`'${name.replace(/"/g, '""')}`);
    }
  );

  it('round-trips tags containing commas without changing their identity', () => {
    const search = updateProductsCatalogueSearch('', {
      ...parseProductsCatalogueState(''),
      tags: ['home, office', 'featured'],
    });
    expect(parseProductsCatalogueState(search).tags).toEqual(['home, office', 'featured']);
  });

  it('creates a stable two-word fallback initial', () => {
    expect(productInitials(' wireless headphones pro ')).toBe('WH');
    expect(productInitials('')).toBe('?');
  });
});
