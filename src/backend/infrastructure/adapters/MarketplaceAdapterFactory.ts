// Factory that resolves a marketplace key to a concrete adapter implementing the
// domain IMarketplaceAdapter port. Keeps the application/domain layers agnostic
// to which concrete adapter backs a given marketplace. Per ARCHITECTURE.md §9,
// OLX/Allegro/Vinted/Facebook are implemented, eBay is a registered stub, and
// Etsy/Amazon are not yet available.

import type { IMarketplaceAdapter } from '../../domain/services/MarketplaceAdapter';
import type { MarketplaceKey } from '../../../shared/types';
import type { MarketplaceHttpClient } from './MarketplaceHttpClient';
import type { MarketplaceAdapterOptions } from './BaseMarketplaceAdapter';
import { MarketplaceNotImplementedError } from './MarketplaceError';
import { OLXAdapter } from './OLXAdapter';
import { AllegroAdapter } from './AllegroAdapter';
import { VintedAdapter } from './VintedAdapter';
import { FacebookAdapter } from './FacebookAdapter';
import { EbayAdapter } from './EbayAdapter';

type AdapterConstructor = new (
  http?: MarketplaceHttpClient,
  options?: MarketplaceAdapterOptions,
) => IMarketplaceAdapter;

export class MarketplaceAdapterFactory {
  private readonly registry = new Map<MarketplaceKey, AdapterConstructor>();

  constructor() {
    this.register('olx', OLXAdapter);
    this.register('allegro', AllegroAdapter);
    this.register('vinted', VintedAdapter);
    this.register('facebook', FacebookAdapter);
    this.register('ebay', EbayAdapter);
    // 'etsy' and 'amazon' are intentionally unregistered (not yet available).
  }

  register(key: MarketplaceKey, ctor: AdapterConstructor): void {
    this.registry.set(key, ctor);
  }

  isSupported(key: MarketplaceKey): boolean {
    return this.registry.has(key);
  }

  // Create an adapter for the given marketplace key. An optional HTTP client can
  // be injected (e.g. a real transport in production, a mock in tests); when
  // omitted the adapter falls back to its deterministic stub transport.
  create(
    key: MarketplaceKey,
    http?: MarketplaceHttpClient,
    options?: MarketplaceAdapterOptions,
  ): IMarketplaceAdapter {
    const ctor = this.registry.get(key);
    if (!ctor) {
      throw new MarketplaceNotImplementedError(
        `No marketplace adapter registered for key: ${key}`,
      );
    }
    return new ctor(http, options);
  }
}
