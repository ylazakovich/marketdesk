import { buildProductHermesRunRequest } from './hermesApi';

describe('Hermes frontend API contract', () => {
  it('builds only product-scoped analysis requests for an explicit product', () => {
    expect(buildProductHermesRunRequest({ productId: 'product-1', trigger: 'manual' })).toEqual({
      url: '/hermes/products/product-1/run',
      method: 'POST',
      body: { trigger: 'manual' },
    });
  });

  it('encodes opaque product ids and never falls back to the legacy catalogue route', () => {
    const request = buildProductHermesRunRequest({ productId: 'product/with space' });

    expect(request).toEqual({
      url: '/hermes/products/product%2Fwith%20space/run',
      method: 'POST',
      body: { trigger: 'manual' },
    });
    expect(request.url).not.toBe('/hermes/run');
  });
});
