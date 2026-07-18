import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DelistConfirmationContent,
  ListingsTable,
  delistDialogReducer,
  initialDelistDialogState,
} from './ListingsTable';
import type { Listing } from '@shared/types';

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    productId: 'product-1',
    productName: 'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan',
    productSku: 'AIRPODS4-PL-001',
    marketplaceId: 'marketplace-1',
    marketplaceListingId: 'olx-1',
    price: 50,
    status: 'live',
    views: 1,
    watchers: 0,
    messages: 0,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('ListingsTable layout', () => {
  it('does not render a detached metrics legend below populated rows', () => {
    const html = renderToStaticMarkup(
      <ListingsTable
        listings={[listing()]}
        productHref={(row) => `/products/${row.productId}`}
        resolveMarketplaceName={() => 'OLX'}
      />,
    );

    expect(html).toContain('Views');
    expect(html).toContain('Watchers');
    expect(html).toContain('Messages');
    expect(html).not.toContain('>views<');
    expect(html).not.toContain('>watchers<');
    expect(html).not.toContain('>messages<');
  });

  it('renders unavailable message metrics explicitly while preserving a real zero', () => {
    const unavailable = renderToStaticMarkup(
      <ListingsTable listings={[listing({ messages: null })]} />,
    );
    const zero = renderToStaticMarkup(
      <ListingsTable listings={[listing({ messages: 0 })]} />,
    );

    expect(unavailable).toContain('>—<');
    expect(zero).toContain('>0<');
  });
});

describe('ListingsTable product identity', () => {
  it('renders product title and SKU before marketplace metadata', () => {
    const html = renderToStaticMarkup(
      <ListingsTable
        listings={[listing()]}
        productHref={(row) => `/products/${row.productId}`}
        resolveMarketplaceName={() => 'OLX'}
      />,
    );

    expect(html).toContain('Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan');
    expect(html).toContain('SKU AIRPODS4-PL-001');
    expect(html).toContain('href="/products/product-1"');
    expect(html).toContain('OLX');
    expect(html.indexOf('Apple AirPods 4')).toBeLessThan(html.indexOf('SKU AIRPODS4-PL-001'));
    expect(html.indexOf('SKU AIRPODS4-PL-001')).toBeLessThan(html.indexOf('OLX'));
  });
});

describe('ListingsTable external marketplace link', () => {
  it('renders a safe external OLX link for live listings', () => {
    const html = renderToStaticMarkup(
      <ListingsTable
        listings={[listing({ externalUrl: 'https://www.olx.pl/d/oferta/olx-1' })]}
        resolveMarketplaceName={() => 'OLX'}
      />,
    );

    expect(html).toContain('View on OLX');
    expect(html).toContain('href="https://www.olx.pl/d/oferta/olx-1"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('does not render the external link for draft listings', () => {
    const html = renderToStaticMarkup(
      <ListingsTable
        listings={[
          listing({
            status: 'draft',
            externalUrl: 'https://www.olx.pl/d/oferta/olx-1',
          }),
        ]}
        resolveMarketplaceName={() => 'OLX'}
      />,
    );

    expect(html).not.toContain('View on OLX');
  });
});

describe('ListingsTable publication actions', () => {
  it('disables publish and relist actions while another publication request is in flight', () => {
    const html = renderToStaticMarkup(
      <ListingsTable
        listings={[
          listing({ id: 'draft', status: 'draft' }),
          listing({ id: 'expired', status: 'expired' }),
        ]}
        onPublish={() => undefined}
        onRelist={() => undefined}
        actionsDisabled
      />,
    );

    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe('ListingsTable destructive delist action', () => {
  it('shows exact listing identity, consequences, and OLX quota risk in confirmation', () => {
    const html = renderToStaticMarkup(
      <DelistConfirmationContent listing={listing()} marketplaceName="Renamed provider" isOlx />,
    );

    expect(html).toContain('Apple AirPods 4');
    expect(html).toContain('olx-1');
    expect(html).toContain('will not be republished automatically');
    expect(html).toContain('does not restore a consumed quota unit');
    expect(html).toContain('category and quota preview');
  });

  it('does not infer OLX quota risk from a marketplace display name', () => {
    const html = renderToStaticMarkup(
      <DelistConfirmationContent listing={listing()} marketplaceName="OLX classifieds clone" isOlx={false} />,
    );

    expect(html).not.toContain('does not restore a consumed quota unit');
  });

  it('offers the destructive action only for live listings with a remote identity', () => {
    const live = renderToStaticMarkup(
      <ListingsTable
        listings={[listing()]}
        onDelistToDraft={async () => ({
          id: 'operation-1', listingId: 'listing-1', marketplaceId: 'marketplace-1',
          state: 'executed', result: null,
        })}
      />,
    );
    const draft = renderToStaticMarkup(
      <ListingsTable
        listings={[listing({ status: 'draft', marketplaceListingId: null })]}
        onDelistToDraft={async () => ({
          id: 'operation-2', listingId: 'listing-1', marketplaceId: 'marketplace-1',
          state: 'executed', result: null,
        })}
      />,
    );

    expect(live).toContain('Снять с площадки и вернуть в черновики');
    expect(draft).not.toContain('Снять с площадки и вернуть в черновики');
  });

  it('retains an ambiguous operation until reconciliation, then starts with a fresh UUID', () => {
    const opened = delistDialogReducer(initialDelistDialogState, {
      type: 'open', listing: listing(), operationId: 'old-operation-uuid',
    });
    const ambiguous = delistDialogReducer(opened, {
      type: 'failed',
      failure: {
        kind: 'ambiguous',
        message: 'provider timeout',
        manualReconciliationRequired: true,
      },
    });

    expect(ambiguous.operationId).toBe('old-operation-uuid');
    expect(ambiguous.failure?.kind).toBe('ambiguous');

    const reconciled = delistDialogReducer(ambiguous, {
      type: 'reconciled_live', operationId: 'fresh-operation-uuid',
    });
    expect(reconciled.operationId).toBe('fresh-operation-uuid');
    expect(reconciled.operationId).not.toBe(ambiguous.operationId);
    expect(reconciled.failure).toBeNull();
  });

  it.each(['authentication', 'validation', 'provider_rejection'] as const)(
    'does not retain a terminal %s operation UUID',
    (kind) => {
      const opened = delistDialogReducer(initialDelistDialogState, {
        type: 'open', listing: listing(), operationId: 'terminal-operation-uuid',
      });
      const failed = delistDialogReducer(opened, {
        type: 'failed',
        failure: { kind, message: kind, manualReconciliationRequired: false },
      });

      expect(failed.failure?.kind).toBe(kind);
      expect(failed.operationId).toBeNull();
    },
  );
});
