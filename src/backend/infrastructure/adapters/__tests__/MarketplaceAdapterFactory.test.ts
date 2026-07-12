import { MarketplaceAdapterFactory } from '../MarketplaceAdapterFactory';
import { OLXAdapter } from '../OLXAdapter';
import { AllegroAdapter } from '../AllegroAdapter';
import { VintedAdapter } from '../VintedAdapter';
import { FacebookAdapter } from '../FacebookAdapter';
import { EbayAdapter } from '../EbayAdapter';
import { MarketplaceNotImplementedError } from '../MarketplaceError';

describe('MarketplaceAdapterFactory', () => {
  const factory = new MarketplaceAdapterFactory();

  it.each([
    ['olx', OLXAdapter],
    ['allegro', AllegroAdapter],
    ['vinted', VintedAdapter],
    ['facebook', FacebookAdapter],
    ['ebay', EbayAdapter],
  ] as const)('creates the %s adapter with a matching key', (key, ctor) => {
    const adapter = factory.create(key);
    expect(adapter).toBeInstanceOf(ctor);
    expect(adapter.getKey()).toBe(key);
  });

  it('reports supported vs unsupported keys', () => {
    expect(factory.isSupported('olx')).toBe(true);
    expect(factory.isSupported('etsy')).toBe(false);
    expect(factory.isSupported('amazon')).toBe(false);
  });

  it('throws MarketplaceNotImplementedError for unregistered keys', () => {
    expect(() => factory.create('etsy')).toThrow(MarketplaceNotImplementedError);
    expect(() => factory.create('amazon')).toThrow(MarketplaceNotImplementedError);
  });

  it('returns the eBay stub adapter whose operations reject as not implemented', async () => {
    const ebay = factory.create('ebay');
    await expect(
      ebay.publish({
        productName: 'x',
        description: 'a description long enough to pass',
        price: 10,
        currency: 'PLN',
        category: 'electronics',
        condition: 'new',
        imageUrls: [],
      }),
    ).rejects.toBeInstanceOf(MarketplaceNotImplementedError);
  });
});
