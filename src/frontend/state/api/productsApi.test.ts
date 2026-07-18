import {
  buildProductImageDeleteRequest,
  buildProductImageUploadRequest,
  buildProductsListUrl,
} from './productsApi';

describe('product image API requests', () => {
  it('uploads the original file as a typed raw request body', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.webp', { type: 'image/webp' });

    expect(buildProductImageUploadRequest(file)).toEqual({
      url: '/uploads/images',
      method: 'POST',
      body: file,
      headers: { 'content-type': 'image/webp' },
    });
  });

  it('targets the workspace-scoped delete endpoint by opaque image id', () => {
    expect(buildProductImageDeleteRequest('123e4567-e89b-42d3-a456-426614174000')).toEqual({
      url: '/uploads/images/123e4567-e89b-42d3-a456-426614174000',
      method: 'DELETE',
    });
  });
});

describe('products list API request', () => {
  it('serializes tags as an unambiguous JSON array so commas round-trip', () => {
    expect(buildProductsListUrl({ tags: ['home, office', 'featured'], limit: 25 })).toBe(
      '/products?limit=25&tags=%5B%22home%2C+office%22%2C%22featured%22%5D'
    );
  });
});
