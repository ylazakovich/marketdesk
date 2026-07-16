import type { MarketplaceHttpClient } from './MarketplaceHttpClient';
import { OlxTaxonomyResolver } from './OlxTaxonomyResolver';

function client(data: unknown): MarketplaceHttpClient {
  return { request: jest.fn(async () => ({ status: 200, data })) };
}

describe('OlxTaxonomyResolver', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');

  it('attests an exact leaf category from the provider response', async () => {
    const request = jest.fn(async ({ url }: { url: string }) => ({
      status: 200,
      data: url.endsWith('/categories/2000')
        ? {
            id: 2000,
            name: 'Projectors',
            path: ['Electronics', 'TV and video', 'Projectors'],
            leaf: true,
          }
        : { data: [
            { id: 1000, name: 'Electronics', parent_id: 0, is_leaf: false },
            { id: 1500, name: 'TV and video', parent_id: 1000, is_leaf: false },
            { id: 2000, name: 'Projectors', parent_id: 1500, is_leaf: true },
          ] },
    }));
    const http = { request: request as MarketplaceHttpClient['request'] };
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
    expect(request).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      url: 'https://example.test/api/categories/2000',
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: 'https://example.test/api/categories',
    });
  });

  it.each([
    ['a one-segment array', ['Projektory']],
    ['a one-segment string', 'Projektory'],
  ])('rejects incomplete direct breadcrumb: %s', async (_label, path) => {
    const request = jest.fn(async ({ url }: { url: string }) => ({
      status: 200,
      data: url.endsWith('/categories/1984')
        ? { id: 1984, name: 'Projektory', path, is_leaf: true }
        : { data: [
            { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
            { id: 1984, name: 'Projektory', parent_id: 99, is_leaf: true },
          ] },
    }));
    const resolver = new OlxTaxonomyResolver(
      { request: request as MarketplaceHttpClient['request'] },
      undefined,
      () => now,
    );

    await expect(resolver.verify('1984')).rejects.toThrow('incomplete');
  });

  it('rejects an unsafe numeric detail id instead of aliasing it', async () => {
    const unsafeId = '9007199254740992';
    const resolver = new OlxTaxonomyResolver(client({
      id: 9007199254740993,
      name: 'Projectors',
      path: ['Electronics', 'Projectors'],
      is_leaf: true,
    }), undefined, () => now);

    await expect(resolver.verify(unsafeId)).rejects.toThrow('different category id');
  });

  it.each([
    ['target children contradict leafness', { id: 1984, name: 'Projektory', is_leaf: true, children: [{ id: 1 }] }],
    ['a non-boolean leaf claim', { id: 1984, name: 'Projektory', leaf: true, is_leaf: 'false' }],
    ['a nested parent asserted as leaf', {
      id: 1984,
      name: 'Projektory',
      is_leaf: true,
      parent: { id: 99, name: 'Elektronika', is_leaf: true, parent: null },
    }],
    ['both path and nested parent representations', {
      id: 1984,
      name: 'Projektory',
      path: ['Elektronika', 'Projektory'],
      is_leaf: true,
      parent: { id: 99, name: 'Elektronika', is_leaf: false, parent: null },
    }],
    ['an explicit null parent for a non-root target', {
      id: 1984,
      name: 'Projektory',
      is_leaf: true,
      parent: null,
    }],
  ])('rejects malformed detail topology: %s', async (_label, detail) => {
    const resolver = new OlxTaxonomyResolver(client(detail), undefined, () => now);
    await expect(resolver.verify('1984')).rejects.toThrow();
  });

  it('rejects nested breadcrumb ids that disagree with the flat taxonomy', async () => {
    const request = jest.fn(async ({ url }: { url: string }) => ({
      status: 200,
      data: url.endsWith('/categories/1984')
        ? {
            id: 1984,
            name: 'Projektory',
            is_leaf: true,
            parent: {
              id: 9999,
              name: 'Sprzęt video',
              is_leaf: false,
              parent: { id: 8888, name: 'Elektronika', is_leaf: false, parent: null },
            },
          }
        : { data: [
            { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
            { id: 1979, name: 'Sprzęt video', parent_id: 99, is_leaf: false },
            { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
          ] },
    }));
    const resolver = new OlxTaxonomyResolver(
      { request: request as MarketplaceHttpClient['request'] },
      undefined,
      () => now,
    );

    await expect(resolver.verify('1984')).rejects.toThrow('does not match');
  });

  it('rejects a detail parent_id that disagrees with the flat taxonomy', async () => {
    const request = jest.fn(async ({ url }: { url: string }) => ({
      status: 200,
      data: url.endsWith('/categories/1984')
        ? { id: 1984, name: 'Projektory', path: ['Elektronika', 'Projektory'], parent_id: 777, is_leaf: true }
        : { data: [
            { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
            { id: 1984, name: 'Projektory', parent_id: 99, is_leaf: true },
          ] },
    }));
    const resolver = new OlxTaxonomyResolver(
      { request: request as MarketplaceHttpClient['request'] },
      undefined,
      () => now,
    );

    await expect(resolver.verify('1984')).rejects.toThrow('parent does not match');
  });

  it('reconstructs a complete path from the authenticated flat taxonomy', async () => {
    const request = jest.fn(async ({ url }: { url: string }) => ({
      status: 200,
      data: url.endsWith('/categories/1984')
        ? { id: 1984, name: 'Projektory', is_leaf: true }
        : { data: [
            { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
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
    ['an intermediate node without parent_id', [
      { id: 1979, name: 'Sprzęt video', is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
    ]],
    ['a null parent on an intermediate node', [
      { id: 1979, name: 'Sprzęt video', parent_id: null, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
    ]],
    ['a child attached to the asserted leaf', [
      { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1979, name: 'Sprzęt video', parent_id: 99, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
      { id: 3000, name: 'Projector accessories', parent_id: 1984, is_leaf: true },
    ]],
    ['an ancestor marked as a leaf', [
      { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1979, name: 'Sprzęt video', parent_id: 99, is_leaf: true },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
    ]],
    ['a string zero root sentinel', [
      { id: 99, name: 'Elektronika', parent_id: '0', is_leaf: false },
      { id: 1979, name: 'Sprzęt video', parent_id: 99, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
    ]],
    ['conflicting target leaf claims', [
      { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1979, name: 'Sprzęt video', parent_id: 99, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, leaf: true, is_leaf: false },
    ]],
    ['a noncanonical parent id', [
      { id: 1979, name: 'Sprzęt video', parent_id: 0, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: '01979', is_leaf: true },
    ]],
    ['an unrelated child with a malformed parent id', [
      { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1979, name: 'Sprzęt video', parent_id: 99, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
      { id: 3000, name: 'Malformed child', parent_id: '01984', is_leaf: true },
    ]],
    ['an unrelated node with a missing parent', [
      { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1979, name: 'Sprzęt video', parent_id: 99, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
      { id: 3000, name: 'Orphan', parent_id: 9999, is_leaf: true },
    ]],
    ['unrelated conflicting leaf claims', [
      { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1979, name: 'Sprzęt video', parent_id: 99, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
      { id: 3000, name: 'Malformed', parent_id: 99, leaf: true, is_leaf: false },
    ]],
    ['a target without an explicit leaf claim', [
      { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 99, children: [] },
    ]],
    ['an ancestor without an explicit leaf claim', [
      { id: 99, name: 'Elektronika', parent_id: 0, children: [{ id: 1984 }] },
      { id: 1984, name: 'Projektory', parent_id: 99, is_leaf: true },
    ]],
    ['an unrelated node without an explicit leaf claim', [
      { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 99, is_leaf: true },
      { id: 3000, name: 'Malformed', parent_id: 99, children: [] },
    ]],
    ['an unrelated cyclic component', [
      { id: 99, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1979, name: 'Sprzę video', parent_id: 99, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 1979, is_leaf: true },
      { id: 3000, name: 'Cycle A', parent_id: 3001, is_leaf: false },
      { id: 3001, name: 'Cycle B', parent_id: 3000, is_leaf: false },
    ]],
    ['a zero category node id', [
      { id: 0, name: 'Elektronika', parent_id: 0, is_leaf: false },
      { id: 1984, name: 'Projektory', parent_id: 0, is_leaf: true },
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
    ['a client-supplied noncanonical id', '02000', { id: 2000, name: 'Projectors', path: ['Electronics', 'Projectors'], leaf: true }],
    ['a whitespace-padded client id', ' 2000 ', { id: 2000, name: 'Projectors', path: ['Electronics', 'Projectors'], leaf: true }],
    ['a mismatched provider id', '2000', { id: 9999, name: 'Projectors', path: ['Electronics', 'Projectors'], leaf: true }],
    ['conflicting detail leaf claims', '2000', { id: 2000, name: 'Projectors', path: ['Electronics', 'Projectors'], leaf: true, is_leaf: false }],
    ['a non-leaf category', '2000', { id: 2000, name: 'Video', path: ['Electronics', 'Video'], leaf: false }],
    ['an incomplete path', '2000', { id: 2000, name: 'Projectors', leaf: true }],
  ])('rejects %s', async (_label, id, response) => {
    const resolver = new OlxTaxonomyResolver(client(response), undefined, () => now);
    await expect(resolver.verify(id)).rejects.toThrow();
  });
});
