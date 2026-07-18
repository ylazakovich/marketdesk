import type { HermesEvent, Listing, Product } from '@shared/types';
import {
  filterHermesEventsForCommandPalette,
  filterListingsForCommandPalette,
  filterProductsForCommandPalette,
  getNextCommandPaletteIndex,
  isCommandPaletteShortcut,
} from './CommandPalette.js';

const listing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 'listing-1',
  productId: 'product-1',
  productName: 'Vintage Camera',
  productSku: 'CAM-001',
  marketplaceId: 'olx',
  marketplaceListingId: 'OLX-42',
  price: 199,
  status: 'active',
  views: 10,
  watchers: 2,
  messages: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const hermesEvent = (overrides: Partial<HermesEvent> = {}): HermesEvent => ({
  id: 'event-1',
  workspaceId: 'workspace-1',
  type: 'price_recommendation',
  severity: 'medium',
  status: 'pending_review',
  title: 'Adjust camera price',
  detail: 'Price is above the marketplace median',
  proposedChange: { kind: 'price', oldPrice: 199, newPrice: 179 },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p-1',
  workspaceId: 'workspace-1',
  sku: 'CAM-001',
  name: 'Vintage Camera',
  description: 'Classic 35mm camera',
  costPrice: 100,
  sellingPrice: 199,
  condition: 'used_good',
  category: 'Cameras',
  status: 'active',
  tags: ['photo'],
  images: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('global command palette', () => {
  it('recognizes both macOS and cross-platform shortcuts', () => {
    expect(isCommandPaletteShortcut({ key: 'k', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isCommandPaletteShortcut({ key: 'K', metaKey: false, ctrlKey: true })).toBe(true);
    expect(isCommandPaletteShortcut({ key: 'k', metaKey: false, ctrlKey: false })).toBe(false);
  });

  it('moves keyboard selection in both directions and wraps at the result boundaries', () => {
    expect(getNextCommandPaletteIndex(0, 'ArrowDown', 3)).toBe(1);
    expect(getNextCommandPaletteIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(getNextCommandPaletteIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(getNextCommandPaletteIndex(1, 'ArrowUp', 3)).toBe(0);
    expect(getNextCommandPaletteIndex(0, 'ArrowDown', 0)).toBe(0);
  });

  it('searches listing identity and product metadata case-insensitively', () => {
    const listings = [
      listing(),
      listing({
        id: 'listing-2',
        productName: 'Desk Lamp',
        productSku: 'LAMP-002',
        marketplaceListingId: 'ALLEGRO-7',
      }),
    ];
    expect(filterListingsForCommandPalette(listings, 'cam-001')).toHaveLength(1);
    expect(filterListingsForCommandPalette(listings, 'olx-42')).toHaveLength(1);
    expect(filterListingsForCommandPalette(listings, 'CAMERA')).toHaveLength(1);
  });

  it('defensively filters products when an API adapter ignores search', () => {
    const products = [
      product(),
      product({
        id: 'p-2',
        sku: 'LAMP-002',
        name: 'Desk Lamp',
        description: 'Minimal lamp',
        category: 'Home',
        tags: ['lighting'],
      }),
    ];
    expect(filterProductsForCommandPalette(products, 'desk')).toHaveLength(1);
    expect(filterProductsForCommandPalette(products, 'photo')).toHaveLength(1);
  });

  it('searches Hermes event title, detail, type, and status', () => {
    const events = [
      hermesEvent(),
      hermesEvent({
        id: 'event-2',
        title: 'Listing expired',
        detail: 'Relist the marketplace advert',
        type: 'listing_expired',
        status: 'resolved',
      }),
    ];
    expect(filterHermesEventsForCommandPalette(events, 'median')).toHaveLength(1);
    expect(filterHermesEventsForCommandPalette(events, 'pending_review')).toHaveLength(1);
    expect(filterHermesEventsForCommandPalette(events, 'PRICE_RECOMMENDATION')).toHaveLength(1);
  });
});
