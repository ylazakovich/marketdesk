// Pure row <-> entity mapper tests. No database required — these MUST pass.

import { ProductMapper } from '../mappers/ProductMapper';
import { ListingMapper } from '../mappers/ListingMapper';
import { MarketplaceMapper } from '../mappers/MarketplaceMapper';
import { EventMapper } from '../mappers/EventMapper';
import { WorkspaceMapper } from '../mappers/WorkspaceMapper';
import { ActivityLogMapper } from '../mappers/ActivityLogMapper';
import type {
  ProductRow,
  ListingRow,
  MarketplaceRow,
  HermesEventRow,
  WorkspaceRow,
  ActivityLogRow,
} from '../mappers/rows';
import { DEFAULT_HERMES_GUARDRAILS } from '../../../../shared/constants';

describe('ProductMapper', () => {
  const baseRow: ProductRow = {
    id: 'prod-1',
    workspace_id: 'ws-1',
    sku: 'SKU-1',
    name: 'Widget',
    description: 'A perfectly reasonable description over twenty chars.',
    cost_price: '15.00',
    selling_price: '29.99',
    condition: 'new',
    category: 'electronics',
    status: 'active',
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-02-01T00:00:00Z'),
    currency: 'PLN',
  };

  it('maps columns, Money and child collections', () => {
    const product = ProductMapper.toDomain(
      baseRow,
      [{ tag: 'sale' }, { tag: 'featured' }],
      [
        { url: 'https://img/2.jpg', position: 1 },
        { url: 'https://img/1.jpg', position: 0 },
      ],
    );

    expect(product.id).toBe('prod-1');
    expect(product.workspaceId).toBe('ws-1');
    expect(product.sku).toBe('SKU-1');
    expect(product.status).toBe('active');
    expect(product.condition).toBe('new');
    expect(product.costPrice.amount).toBe(15);
    expect(product.costPrice.currency).toBe('PLN');
    expect(product.sellingPrice.amount).toBe(29.99);
    expect([...product.tags]).toEqual(['sale', 'featured']);
    // images ordered by position
    expect([...product.images]).toEqual(['https://img/1.jpg', 'https://img/2.jpg']);
    expect(product.createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(product.updatedAt.toISOString()).toBe('2024-02-01T00:00:00.000Z');
  });

  it('parses numeric decimal prices as well as strings', () => {
    const product = ProductMapper.toDomain(
      { ...baseRow, cost_price: 8, selling_price: 19.99 },
      [],
      [],
    );
    expect(product.costPrice.amount).toBe(8);
    expect(product.sellingPrice.amount).toBe(19.99);
    expect(product.tags.length).toBe(0);
    expect(product.images.length).toBe(0);
  });

  it('rehydrates valid category provenance and rejects malformed JSONB claims', () => {
    const valid = ProductMapper.toDomain({
      ...baseRow,
      category_provenance: {
        status: 'synced',
        sources: [{
          marketplaceKey: 'olx', marketplaceId: 'mkt-1', listingId: 'list-1',
          providerCategoryId: '100', name: 'Projectors',
          path: ['Electronics', 'Projectors'],
          taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
          syncedAt: '2026-07-15T01:00:00.000Z',
        }],
      },
    }, [], []);
    expect(valid.categoryProvenance).toMatchObject({ status: 'synced' });

    const malformed = ProductMapper.toDomain({
      ...baseRow,
      category_provenance: {
        status: 'synced',
        sources: [{ marketplaceKey: 'olx', providerCategoryId: '100', path: [] }],
      } as never,
    }, [], []);
    expect(malformed.categoryProvenance).toBeNull();
  });
});

describe('ListingMapper', () => {
  const baseRow: ListingRow = {
    id: 'list-1',
    product_id: 'prod-1',
    marketplace_id: 'mkt-1',
    marketplace_listing_id: 'ext-123',
    external_url: 'https://www.olx.pl/d/oferta/ext-123',
    price: '49.99',
    status: 'live',
    views: 10,
    watchers: 3,
    messages: 1,
    published_at: new Date('2024-03-01T00:00:00Z'),
    expires_at: new Date('2024-04-01T00:00:00Z'),
    sync_error: null,
    last_sync_at: new Date('2024-03-15T00:00:00Z'),
    created_at: new Date('2024-03-01T00:00:00Z'),
    updated_at: new Date('2024-03-15T00:00:00Z'),
    currency: 'PLN',
  };

  it('maps a live listing with all fields', () => {
    const listing = ListingMapper.toDomain(baseRow);
    expect(listing.id).toBe('list-1');
    expect(listing.productId).toBe('prod-1');
    expect(listing.marketplaceId).toBe('mkt-1');
    expect(listing.marketplaceListingId).toBe('ext-123');
    expect(listing.externalUrl).toBe('https://www.olx.pl/d/oferta/ext-123');
    expect(listing.price.amount).toBe(49.99);
    expect(listing.price.currency).toBe('PLN');
    expect(listing.status).toBe('live');
    expect(listing.views).toBe(10);
    expect(listing.watchers).toBe(3);
    expect(listing.messages).toBe(1);
    expect(listing.isLive()).toBe(true);
    expect(listing.publishedAt?.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(listing.expiresAt?.toISOString()).toBe('2024-04-01T00:00:00.000Z');
    expect(listing.syncError).toBeNull();
  });

  it('maps nullable columns to null', () => {
    const listing = ListingMapper.toDomain({
      ...baseRow,
      status: 'draft',
      marketplace_listing_id: null,
      external_url: null,
      published_at: null,
      expires_at: null,
      last_sync_at: null,
      sync_error: 'boom',
    });
    expect(listing.marketplaceListingId).toBeNull();
    expect(listing.externalUrl).toBeNull();
    expect(listing.publishedAt).toBeNull();
    expect(listing.expiresAt).toBeNull();
    expect(listing.lastSyncAt).toBeNull();
    expect(listing.syncError).toBe('boom');
    expect(listing.status).toBe('draft');
  });
});

describe('MarketplaceMapper', () => {
  const baseRow: MarketplaceRow = {
    id: 'mkt-1',
    workspace_id: 'ws-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    sync_mode: 'hourly',
    last_sync_at: new Date('2024-05-01T00:00:00Z'),
    error_count: 2,
    capacity: 250,
    created_at: new Date('2024-01-01T00:00:00Z'),
  };

  it('maps a connected marketplace', () => {
    const mkt = MarketplaceMapper.toDomain(baseRow);
    expect(mkt.id).toBe('mkt-1');
    expect(mkt.workspaceId).toBe('ws-1');
    expect(mkt.key).toBe('olx');
    expect(mkt.name).toBe('OLX');
    expect(mkt.isConnected()).toBe(true);
    expect(mkt.syncMode).toBe('hourly');
    expect(mkt.errorCount).toBe(2);
    expect(mkt.capacity).toBe(250);
    expect(mkt.lastSyncAt?.toISOString()).toBe('2024-05-01T00:00:00.000Z');
  });

  it('maps a disconnected marketplace with null lastSync', () => {
    const mkt = MarketplaceMapper.toDomain({
      ...baseRow,
      connected: false,
      last_sync_at: null,
    });
    expect(mkt.isConnected()).toBe(false);
    expect(mkt.lastSyncAt).toBeNull();
  });
});

describe('EventMapper', () => {
  const baseRow: HermesEventRow = {
    id: 'evt-1',
    workspace_id: 'ws-1',
    product_id: 'prod-1',
    type: 'suggested_lower_price',
    severity: 'warning',
    status: 'pending_review',
    title: 'Lower your price',
    detail: 'Competitors are cheaper',
    proposed_change: { kind: 'price', field: 'price', from: 100, to: 80 },
    autonomy_decision: 'pending_review',
    created_at: new Date('2024-06-01T00:00:00Z'),
    resolved_at: null,
  };

  it('maps a price event with typed proposed change', () => {
    const event = EventMapper.toDomain(baseRow);
    expect(event.id).toBe('evt-1');
    expect(event.type).toBe('suggested_lower_price');
    expect(event.severity).toBe('warning');
    expect(event.status).toBe('pending_review');
    expect(event.productId).toBe('prod-1');
    expect(event.proposedChange).toEqual({
      kind: 'price',
      field: 'price',
      from: 100,
      to: 80,
    });
    expect(event.autonomyDecision).toBe('pending_review');
    expect(event.resolvedAt).toBeNull();
  });

  it('maps an informational event with null proposed change and null product', () => {
    const event = EventMapper.toDomain({
      ...baseRow,
      type: 'suggested_more_photos',
      product_id: null,
      proposed_change: null,
      autonomy_decision: null,
      status: 'dismissed',
      resolved_at: new Date('2024-06-02T00:00:00Z'),
    });
    expect(event.productId).toBeNull();
    expect(event.proposedChange).toBeNull();
    expect(event.autonomyDecision).toBeNull();
    expect(event.status).toBe('dismissed');
    expect(event.resolvedAt?.toISOString()).toBe('2024-06-02T00:00:00.000Z');
  });
});

describe('WorkspaceMapper', () => {
  const baseRow: WorkspaceRow = {
    id: 'ws-1',
    name: 'Demo Workspace',
    currency: 'PLN',
    timezone: 'Europe/Warsaw',
    autonomy_level: 'balanced',
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-02T00:00:00Z'),
  };

  it('maps workspace columns and defaults guardrails', () => {
    const ws = WorkspaceMapper.toDomain(baseRow);
    expect(ws.id).toBe('ws-1');
    expect(ws.name).toBe('Demo Workspace');
    expect(ws.currency).toBe('PLN');
    expect(ws.timezone).toBe('Europe/Warsaw');
    expect(ws.autonomyLevel).toBe('balanced');
    // guardrails have no column and fall back to defaults
    expect(ws.guardrails.maxAutoPriceChangePct).toBe(
      DEFAULT_HERMES_GUARDRAILS.maxAutoPriceChangePct,
    );
    expect(ws.guardrails.minMarginFloor).toBe(DEFAULT_HERMES_GUARDRAILS.minMarginFloor);
  });
});

describe('ActivityLogMapper', () => {
  const baseRow: ActivityLogRow = {
    id: 'log-1',
    workspace_id: 'ws-1',
    entity_type: 'product',
    entity_id: 'prod-1',
    actor_type: 'hermes',
    actor_id: null,
    action: 'price_updated',
    metadata: { from: 100, to: 80 },
    created_at: new Date('2024-07-01T00:00:00Z'),
  };

  it('maps an entry, converting null actorId to undefined', () => {
    const entry = ActivityLogMapper.toDomain(baseRow);
    expect(entry.id).toBe('log-1');
    expect(entry.workspaceId).toBe('ws-1');
    expect(entry.entityType).toBe('product');
    expect(entry.entityId).toBe('prod-1');
    expect(entry.actorType).toBe('hermes');
    expect(entry.actorId).toBeUndefined();
    expect(entry.action).toBe('price_updated');
    expect(entry.metadata).toEqual({ from: 100, to: 80 });
    expect(entry.createdAt.toISOString()).toBe('2024-07-01T00:00:00.000Z');
  });

  it('keeps actorId when present and null metadata becomes undefined', () => {
    const entry = ActivityLogMapper.toDomain({
      ...baseRow,
      actor_id: 'user-9',
      actor_type: 'user',
      metadata: null,
    });
    expect(entry.actorId).toBe('user-9');
    expect(entry.actorType).toBe('user');
    expect(entry.metadata).toBeUndefined();
  });
});
