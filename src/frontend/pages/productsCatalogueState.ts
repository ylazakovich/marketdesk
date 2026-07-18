import type { Product, ProductStatus } from '@shared/types';

export const PRODUCTS_PAGE_SIZE = 25;
export const PRODUCT_SEARCH_DEBOUNCE_MS = 200;
export type ProductsView = 'list' | 'card';
export type ProductsTab = 'all' | 'active' | 'attention' | 'draft';

export interface ProductsCatalogueState {
  tab: ProductsTab;
  search: string;
  tags: string[];
  priceMin: string;
  priceMax: string;
  sort: string;
  page: number;
  view: ProductsView;
}

const SORTS = new Set([
  'name',
  '-name',
  'sellingPrice',
  '-sellingPrice',
  'costPrice',
  '-costPrice',
  'status',
  '-status',
  'updatedAt',
  '-updatedAt',
]);
const TABS = new Set<ProductsTab>(['all', 'active', 'attention', 'draft']);

export function parseProductsCatalogueState(search: string): ProductsCatalogueState {
  const query = new URLSearchParams(search);
  const tabValue = query.get('tab') as ProductsTab | null;
  const pageValue = Number.parseInt(query.get('page') ?? '1', 10);
  const sortValue = query.get('sort') ?? '-updatedAt';
  return {
    tab: tabValue && TABS.has(tabValue) ? tabValue : 'all',
    search: query.get('search') ?? '',
    tags: query.getAll('tag').length
      ? query
          .getAll('tag')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : (query.get('tags') ?? '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
    priceMin: query.get('priceMin') ?? '',
    priceMax: query.get('priceMax') ?? '',
    sort: SORTS.has(sortValue) ? sortValue : '-updatedAt',
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue - 1 : 0,
    view: query.get('view') === 'card' ? 'card' : 'list',
  };
}

export function updateProductsCatalogueSearch(
  currentSearch: string,
  patch: Partial<ProductsCatalogueState>
): string {
  const current = parseProductsCatalogueState(currentSearch);
  const next = { ...current, ...patch };
  const query = new URLSearchParams(currentSearch);
  for (const key of [
    'tab',
    'search',
    'tag',
    'tags',
    'priceMin',
    'priceMax',
    'sort',
    'page',
    'view',
  ]) {
    query.delete(key);
  }
  if (next.tab !== 'all') query.set('tab', next.tab);
  if (next.search.trim()) query.set('search', next.search.trim());
  next.tags.forEach((tag) => query.append('tag', tag));
  if (next.priceMin.trim()) query.set('priceMin', next.priceMin.trim());
  if (next.priceMax.trim()) query.set('priceMax', next.priceMax.trim());
  if (next.sort !== '-updatedAt') query.set('sort', next.sort);
  if (next.page > 0) query.set('page', String(next.page + 1));
  if (next.view === 'card') query.set('view', 'card');
  const result = query.toString();
  return result ? `?${result}` : '';
}

export function tabStatus(tab: ProductsTab): ProductStatus[] | undefined {
  return tab === 'all' ? undefined : [tab];
}

export function hasCatalogueFilters(state: ProductsCatalogueState): boolean {
  return Boolean(
    state.tab !== 'all' ||
    state.search.trim() ||
    state.tags.length ||
    state.priceMin.trim() ||
    state.priceMax.trim()
  );
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const text = /^[\t\r\n]|^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function productsToCsv(products: Product[], currency: string): string {
  const rows = products.map((product) => [
    product.id,
    product.sku,
    product.name,
    product.status,
    product.category,
    product.costPrice ?? '',
    product.sellingPrice,
    currency,
    product.tags.join('|'),
    product.updatedAt,
  ]);
  return [
    [
      'id',
      'sku',
      'name',
      'status',
      'category',
      'costPrice',
      'sellingPrice',
      'currency',
      'tags',
      'updatedAt',
    ],
    ...rows,
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

export function productInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return initials || '?';
}
