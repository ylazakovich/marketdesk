import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Listing, PriceHistory, Product } from '@shared/types';
import { darkTheme } from '../../theme/darkTheme';
import { lightTheme } from '../../theme/lightTheme';
import {
  OlxInsightsCard,
  PriceHistoryCard,
  PricingSummaryCard,
  ProductCategoryEvidence,
  ProductDescriptionCard,
  productDetailGridSx,
  ProductGalleryCard,
  ProductIdentityHero,
  productDetailRailSx,
  ProductTimelineCard,
} from './ProductDetailSections';

const product: Product = {
  id: 'product-1',
  workspaceId: 'workspace-1',
  sku: 'SKU-38412',
  name: 'Wireless Headphones Pro',
  description: 'Real product description',
  costPrice: 149,
  sellingPrice: 329,
  condition: 'new',
  category: 'Audio',
  status: 'active',
  tags: ['audio', 'wireless'],
  images: ['https://example.test/cover.jpg', 'https://example.test/side.jpg'],
  createdAt: '2026-07-14T10:00:00.000Z',
  updatedAt: '2026-07-16T10:00:00.000Z',
};

const listing: Listing = {
  id: 'listing-1',
  productId: product.id,
  marketplaceId: 'olx-id',
  marketplaceListingId: 'olx-123',
  externalUrl: 'https://www.olx.pl/d/oferta/olx-123',
  price: 329,
  status: 'live',
  remoteStatus: 'active',
  remoteStatusLabel: 'Active',
  isRemotePending: false,
  views: 125,
  watchers: null,
  conversations: 2,
  messages: 4,
  metricsAvailability: { views: true, watchers: false, conversations: true, messages: true },
  publishedAt: '2026-07-15T10:00:00.000Z',
  lastSyncAt: '2026-07-16T09:00:00.000Z',
  createdAt: '2026-07-15T09:00:00.000Z',
  updatedAt: '2026-07-16T09:00:00.000Z',
};

const history: PriceHistory[] = [
  { id: 'price-2', listingId: listing.id, oldPrice: 349, newPrice: 329, changedBy: 'hermes', reason: 'Approved recommendation', createdAt: '2026-07-16T08:00:00.000Z' },
  { id: 'price-1', listingId: listing.id, newPrice: 349, changedBy: 'user', createdAt: '2026-07-15T08:00:00.000Z' },
];

function render(node: React.ReactNode, dark = false) {
  return renderToStaticMarkup(<ThemeProvider theme={dark ? darkTheme : lightTheme}>{node}</ThemeProvider>);
}

describe('product detail redesign sections', () => {
  it('renders populated identity, gallery, pricing, real OLX metrics, history and timeline', () => {
    const html = render(<>
      <ProductIdentityHero product={product} onEdit={() => undefined} />
      <ProductGalleryCard name={product.name} images={product.images} activeIndex={0} onSelect={() => undefined} />
      <PricingSummaryCard product={product} currency="PLN" onEdit={() => undefined} />
      <OlxInsightsCard listing={listing} isOlx statusTitle="OLX listing" statusLabel="Active on OLX" statusExplanation="Provider status" statusColor="success" />
      <PriceHistoryCard listing={listing} history={history} loading={false} currency="PLN" />
      <ProductTimelineCard product={product} listing={listing} />
    </>);

    expect(html).toContain('Wireless Headphones Pro');
    expect(html).toContain('<h1');
    expect(html).toContain('SKU-38412');
    expect(html).toContain('photo 1');
    expect(html).toContain('125');
    expect(html).toContain('Unknown');
    expect(html).toContain('Conversations');
    expect(html).toContain('grid-template-columns:repeat(2, minmax(0, 1fr))');
    expect(html).toContain('data-testid="olx-insights-metrics"');
    expect(html).toContain('OLX chats');
    expect(html).toContain('Conversion is not shown');
    expect(html).toContain('Recorded price history chart');
    expect(html).toContain('Approved recommendation');
    expect(html).toContain('Marketplace status and data synced');
  });

  it('renders honest empty image, description, tag, listing, metric and price states', () => {
    const emptyProduct = { ...product, description: '', tags: [], images: [], costPrice: null };
    const html = render(<>
      <ProductGalleryCard name={emptyProduct.name} images={[]} activeIndex={0} onSelect={() => undefined} />
      <ProductDescriptionCard product={emptyProduct} onEdit={() => undefined} />
      <PricingSummaryCard product={emptyProduct} currency="PLN" onEdit={() => undefined} />
      <OlxInsightsCard isOlx={false} statusTitle="OLX listing" statusLabel="Not synced" statusExplanation="Unavailable" statusColor="default" />
      <PriceHistoryCard loading={false} currency="PLN" />
    </>);

    expect(html).toContain('No images yet');
    expect(html).toContain('No description has been added');
    expect(html).toContain('No tags');
    expect(html).toContain('No OLX listing is connected');
    expect(html).toContain('No marketplace listing exists yet');
  });

  it('keeps loading and error states distinct from honest empty states', () => {
    const loadingHtml = render(<>
      <OlxInsightsCard loading isOlx={false} statusTitle="OLX listing" statusLabel="Unknown" statusExplanation="Unknown" statusColor="default" />
      <PriceHistoryCard listing={listing} loading currency="PLN" />
    </>);
    const errorHtml = render(<>
      <OlxInsightsCard error={{ status: 503 }} isOlx={false} statusTitle="OLX listing" statusLabel="Unknown" statusExplanation="Unknown" statusColor="default" />
      <PriceHistoryCard listing={listing} error={{ status: 503 }} loading={false} currency="PLN" />
    </>);

    expect(loadingHtml).not.toContain('No OLX listing is connected');
    expect(loadingHtml).not.toContain('No price changes recorded yet');
    expect(errorHtml).toContain('OLX listing data unavailable');
    expect(errorHtml).toContain('Price history unavailable');
    expect(errorHtml).not.toContain('No OLX listing is connected');
  });

  it('preserves exact category provenance and freshness evidence', () => {
    const withProvenance: Product = {
      ...product,
      categoryProvenance: {
        status: 'synced',
        sources: [{
          marketplaceKey: 'olx', marketplaceId: 'olx-id', listingId: 'listing-1',
          providerCategoryId: '2078', name: 'Wireless headphones',
          path: ['Electronics', 'Headphones', 'Wireless headphones'],
          taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
          syncedAt: '2026-07-16T00:00:00.000Z',
        }],
      },
    };
    const html = render(<ProductCategoryEvidence product={withProvenance} conflictLines={[]} />);

    expect(html).toContain('provider category ID 2078');
    expect(html).toContain('listing listing-1');
    expect(html).toContain('Taxonomy verified');
    expect(html).toContain('synced');
  });

  it('defines a narrow single-column layout and desktop sticky recommendation rail', () => {
    expect(productDetailGridSx.gridTemplateColumns).toEqual(expect.objectContaining({
      xs: 'minmax(0, 1fr)',
      lg: 'minmax(0, 1fr) minmax(300px, 360px)',
    }));
    expect(productDetailRailSx.position).toEqual({ xs: 'static', lg: 'sticky' });
  });

  it.each([false, true])('renders using theme palette tokens in %s mode', (dark) => {
    const html = render(<ProductIdentityHero product={product} onEdit={() => undefined} />, dark);
    expect(html).toContain('Wireless Headphones Pro');
    expect(html).not.toContain('undefined');
  });
});
