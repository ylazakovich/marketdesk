import type { MarketplaceHttpClient } from './MarketplaceHttpClient';
import { OlxTaxonomyResolver } from './OlxTaxonomyResolver';

function client(data: unknown): MarketplaceHttpClient {
  return { request: jest.fn(async () => ({ status: 200, data })) };
}

describe('OlxTaxonomyResolver', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');

  it('attests an exact leaf category from the provider response', async () => {
    const http = client({
      id: 2000,
      name: 'Projectors',
      path: ['Electronics', 'TV and video', 'Projectors'],
      leaf: true,
    });
    const resolver = new OlxTaxonomyResolver(http, 'https://example.test/api', () => now);

    await expect(resolver.verify('2000')).resolves.toEqual({
      providerCategoryId: '2000',
      name: 'Projectors',
      path: ['Electronics', 'TV and video', 'Projectors'],
      source: 'provider_taxonomy',
      confidence: 1,
      isLeaf: true,
      taxonomyVerifiedAt: now.toISOString(),
      taxonomyStaleAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(http.request).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://example.test/api/categories/2000',
    });
  });

  it('reconstructs a complete path from the authenticated flat taxonomy', async () => {
    const request = jest.fn(async ({ url }: { url: string }) => ({
      status: 200,
      data: url.endsWith('/categories/1984')
        ? { id: 1984, name: 'Projektory', is_leaf: true }
        : { data: [
            { id: 99, name: 'Elektronika', parent_id: null, is_leaf: false },
            { id: 1979, name: 'Sprzęt video', parent_id: 99, is_leaf: false },
            { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
          ] },
    }));
    const resolver = new OlxTaxonomyResolver(
      { request: request as MarketplaceHttpClient['request'] },
      'https://example.test/api',
      () => now,
    );

    await expect(resolver.verify('1984')).resolves.toMatchObject({
      providerCategoryId: '1984',
      name: 'Projektory',
      path: ['Elektronika', 'Sprzęt video', 'Projektory'],
      isLeaf: true,
      source: 'provider_taxonomy',
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: 'https://example.test/api/categories',
    });
  });

  it.each([
    ['a missing parent', [
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
    ]],
    ['a cyclic parent graph', [
      { id: 1979, name: 'Sprzęt video', parent_id: 1984, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
    ]],
  ])('rejects flat taxonomy with %s', async (_label, categories) => {
    const request = jest.fn(async ({ url }: { url: string }) => ({
      status: 200,
      data: url.endsWith('/categories/1984')
        ? { id: 1984, name: 'Projektory', is_leaf: true }
        : { data: categories },
    }));
    const resolver = new OlxTaxonomyResolver(
      { request: request as MarketplaceHttpClient['request'] },
      undefined,
      () => now,
    );

    await expect(resolver.verify('1984')).rejects.toThrow('complete category path');
  });

  it.each([
    ['a client-supplied non-numeric id', 'projectors', { id: 2000, name: 'Projectors', path: ['Electronics', 'Projectors'], leaf: true }],
    ['a mismatched provider id', '2000', { id: 9999, name: 'Projectors', path: ['Electronics', 'Projectors'], leaf: true }],
    ['a non-leaf category', '2000', { id: 2000, name: 'Video', path: ['Electronics', 'Video'], leaf: false }],
    ['an incomplete path', '2000', { id: 2000, name: 'Projectors', leaf: true }],
  ])('rejects %s', async (_label, id, response) => {
    const resolver = new OlxTaxonomyResolver(client(response), undefined, () => now);
    await expect(resolver.verify(id)).rejects.toThrow();
  });
});
