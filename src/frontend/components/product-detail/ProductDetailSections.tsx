import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { Listing, PriceHistory, Product } from '@shared/types';
import { Card } from '../common/Card.js';
import { ProductStatusBadge } from '../common/Badge.js';
import { LoadingSkeleton } from '../common/Skeleton.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { formatCurrency, formatDateTime } from '../../utils/formatters.js';
import { conditionLabel } from '../../utils/labels.js';

export const mainPreviewImageSx = {
  display: 'block',
  width: 'auto',
  height: 'auto',
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  margin: 'auto',
} as const;

export const productDetailGridSx = {
  display: 'grid',
  gap: { xs: 2, lg: 3 },
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(300px, 360px)' },
  alignItems: 'start',
} as const;

export const productDetailRailSx = {
  position: { xs: 'static', lg: 'sticky' },
  top: { lg: 88 },
  minWidth: 0,
} as const;

const EmptyState: React.FC<{ title: string; detail: string }> = ({ title, detail }) => (
  <Stack spacing={1} sx={{ minHeight: 150, px: 2, textAlign: 'center', alignItems: 'center', justifyContent: 'center' }}>
    <ImageOutlinedIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
    <Typography variant="subtitle2">{title}</Typography>
    <Typography variant="body2" color="text.secondary">{detail}</Typography>
  </Stack>
);

export const ProductIdentityHero: React.FC<{
  product: Product;
  onEdit: () => void;
}> = ({ product, onEdit }) => (
  <Box
    component="section"
    aria-labelledby="product-detail-title"
    sx={{
      mb: { xs: 2, md: 3 },
      p: { xs: 2, md: 3 },
      borderRadius: 3,
      border: '1px solid',
      borderColor: 'divider',
      bgcolor: 'background.paper',
      backgroundImage: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main}12, transparent 48%)`,
    }}
  >
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 1, flexWrap: 'wrap' }}>
          <ProductStatusBadge status={product.status} />
          <Chip size="small" variant="outlined" label={conditionLabel(product.condition)} />
          {product.category && <Chip size="small" variant="outlined" label={product.category} />}
        </Stack>
        <Typography id="product-detail-title" component="h1" variant="h2" sx={{ overflowWrap: 'anywhere' }}>
          {product.name}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          Product detail · {product.sku || 'SKU unavailable'}
        </Typography>
      </Box>
      <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={onEdit} sx={{ alignSelf: { sm: 'flex-start' } }}>
        Edit product
      </Button>
    </Stack>
  </Box>
);

export const ProductGalleryCard: React.FC<{
  name: string;
  images: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
}> = ({ name, images, activeIndex, onSelect }) => {
  const selected = images.length ? Math.min(activeIndex, images.length - 1) : 0;
  return (
    <Card title="Gallery" subtitle={images.length ? `${images.length} product photo${images.length === 1 ? '' : 's'}` : 'No product photos'}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: images.length > 1 ? 'minmax(0, 1fr) 76px' : '1fr' }, gap: 1.5 }}>
        <Box sx={{ minHeight: { xs: 260, md: 420 }, aspectRatio: '16 / 10', borderRadius: 2.5, overflow: 'hidden', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {images.length ? <Box component="img" src={images[selected]} alt={`${name}, photo ${selected + 1}`} sx={mainPreviewImageSx} /> : <EmptyState title="No images yet" detail="Add product photos when they are available." />}
        </Box>
        {images.length > 1 && (
          <Stack direction={{ xs: 'row', sm: 'column' }} spacing={1} sx={{ overflow: 'auto', pb: { xs: 0.5, sm: 0 } }} aria-label="Product gallery thumbnails">
            {images.map((image, index) => (
              <IconButton
                key={`${image}:${index}`}
                aria-label={`Show photo ${index + 1}`}
                aria-pressed={index === selected}
                onClick={() => onSelect(index)}
                sx={{ p: 0.5, borderRadius: 2, flex: '0 0 auto', border: '2px solid', borderColor: index === selected ? 'primary.main' : 'transparent', '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}
              >
                <Box component="img" src={image} alt="" sx={{ width: 60, height: 60, borderRadius: 1.25, objectFit: 'cover' }} />
              </IconButton>
            ))}
          </Stack>
        )}
      </Box>
    </Card>
  );
};

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography>
    <Typography component="div" variant="body2" sx={{ fontWeight: 600, mt: 0.25, overflowWrap: 'anywhere' }}>{children}</Typography>
  </Box>
);

export const ProductDescriptionCard: React.FC<{ product: Product; onEdit: () => void }> = ({ product, onEdit }) => (
  <Card title="Description & details" action={<Button size="small" startIcon={<EditOutlinedIcon />} onClick={onEdit}>Edit</Button>}>
    <Typography variant="body2" color={product.description ? 'text.primary' : 'text.secondary'} sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
      {product.description || 'No description has been added.'}
    </Typography>
    <Divider sx={{ my: 2 }} />
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
      <Fact label="Condition">{conditionLabel(product.condition)}</Fact>
      <Fact label="Category">{product.category || 'Unknown'}</Fact>
    </Box>
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 2, flexWrap: 'wrap' }}>
      {product.tags.length ? product.tags.map((tag) => <Chip key={tag} size="small" label={tag} variant="outlined" />) : <Typography variant="caption" color="text.secondary">No tags</Typography>}
    </Stack>
  </Card>
);

export const ProductCategoryEvidence: React.FC<{ product: Product; conflictLines: string[] }> = ({ product, conflictLines }) => {
  const provenance = product.categoryProvenance;
  if (!provenance) return null;
  return (
    <Card title="Category evidence" subtitle="Exact provider taxonomy evidence">
      {provenance.status === 'synced' ? (
        <Stack spacing={1.25}>
          {provenance.sources.map((source) => (
            <Box key={`${source.marketplaceId}:${source.listingId}`} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{source.path.join(' → ')}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {source.marketplaceKey.toUpperCase()} · listing {source.listingId} · provider category ID {source.providerCategoryId}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Taxonomy verified {formatDateTime(source.taxonomyVerifiedAt)} · synced {formatDateTime(source.syncedAt)}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : (
        <Stack spacing={1}>
          <Alert severity="warning">Conflicting active listing categories require review.</Alert>
          {conflictLines.map((line) => <Typography key={line} variant="caption" sx={{ overflowWrap: 'anywhere' }}>{line}</Typography>)}
          <Typography variant="caption" color="text.secondary">
            Conflict detected {formatDateTime(provenance.detectedAt)}
          </Typography>
        </Stack>
      )}
    </Card>
  );
};

export const PricingSummaryCard: React.FC<{ product: Product; currency: string; onEdit: () => void }> = ({ product, currency, onEdit }) => {
  const cost = product.costPrice;
  const profit = cost == null ? null : product.sellingPrice - cost;
  const margin = profit == null || product.sellingPrice === 0 ? null : (profit / product.sellingPrice) * 100;
  return (
    <Card title="Pricing & status" sx={{ borderColor: 'primary.main' }}>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Selling price</Typography>
          <Typography variant="h3" sx={{ mt: 0.25 }}>{formatCurrency(product.sellingPrice, currency)}</Typography>
        </Box>
        <ProductStatusBadge status={product.status} />
      </Stack>
      <Divider sx={{ my: 2 }} />
      <Stack spacing={1}>
        <Fact label="Cost">{cost == null ? 'Unknown' : formatCurrency(cost, currency)}</Fact>
        <Fact label="Profit">{profit == null ? 'Unknown' : formatCurrency(profit, currency)}</Fact>
        <Fact label="Margin">{margin == null ? 'Unknown' : `${Math.round(margin)}%`}</Fact>
      </Stack>
      <Button fullWidth variant="contained" startIcon={<EditOutlinedIcon />} onClick={onEdit} sx={{ mt: 2, minHeight: 44 }}>Edit product</Button>
    </Card>
  );
};

const metricValue = (listing: Listing, key: 'views' | 'watchers' | 'messages') => {
  const available = listing.metricsAvailability?.[key] ?? listing[key] != null;
  return available && listing[key] != null ? String(listing[key]) : 'Unknown';
};

export const OlxInsightsCard: React.FC<{
  listing?: Listing;
  isOlx: boolean;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  statusTitle: string;
  statusLabel: string;
  statusExplanation: string;
  statusColor: 'default' | 'success' | 'warning' | 'error';
}> = ({ listing, isOlx, loading = false, error, onRetry, statusTitle, statusLabel, statusExplanation, statusColor }) => (
  <Card title="OLX insights" subtitle="Provider-reported status and metrics only">
    {loading ? (
      <LoadingSkeleton lines={3} height={40} />
    ) : error ? (
      <ErrorRetry error={error} onRetry={onRetry} title="OLX listing data unavailable" compact />
    ) : !listing || !isOlx ? (
      <Alert severity="info">No OLX listing is connected. Provider metrics are unavailable.</Alert>
    ) : (
      <Stack spacing={2}>
        <Box>
          <Typography variant="caption" color="text.secondary">{statusTitle}</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip size="small" label={statusLabel} color={statusColor} variant="outlined" />
            {listing.externalUrl && <Button component="a" href={listing.externalUrl} target="_blank" rel="noreferrer" size="small" endIcon={<OpenInNewIcon />}>Open OLX</Button>}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{statusExplanation}</Typography>
          {listing.lastSyncAt && <Typography variant="caption" color="text.secondary">Last checked {formatDateTime(listing.lastSyncAt)}</Typography>}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
          {(['views', 'watchers', 'messages'] as const).map((key) => (
            <Box key={key} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover', minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{key}</Typography>
              <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{metricValue(listing, key)}</Typography>
            </Box>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary">Conversion is not shown because no provider conversion metric exists.</Typography>
      </Stack>
    )}
  </Card>
);

function sparklinePoints(history: PriceHistory[]): string {
  const ordered = [...history].reverse();
  const values = ordered.map((item) => item.newPrice);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((value, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = max === min ? 20 : 38 - ((value - min) / (max - min)) * 32;
    return `${x},${y}`;
  }).join(' ');
}

export const PriceHistoryCard: React.FC<{
  listing?: Listing;
  history?: PriceHistory[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  currency: string;
}> = ({ listing, history = [], loading, error, onRetry, currency }) => (
  <Card title="Price history" subtitle={listing ? `Current listing price ${formatCurrency(listing.price, currency)}` : 'Real listing price changes'}>
    {loading ? <LoadingSkeleton lines={3} height={32} /> : error ? <ErrorRetry error={error} onRetry={onRetry} title="Price history unavailable" compact /> : !listing ? <Typography variant="body2" color="text.secondary">No marketplace listing exists yet.</Typography> : history.length === 0 ? <Typography variant="body2" color="text.secondary">No price changes recorded yet.</Typography> : (
      <Stack spacing={1.5}>
        <Box component="svg" role="img" aria-label="Recorded price history chart" viewBox="0 0 100 42" preserveAspectRatio="none" sx={{ width: '100%', height: 96, color: 'primary.main', overflow: 'visible' }}>
          <polyline points={sparklinePoints(history)} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        </Box>
        <Stack divider={<Divider />}>
          {history.map((entry) => (
            <Stack key={entry.id} direction={{ xs: 'column', sm: 'row' }} spacing={0.5} sx={{ py: 1, justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{entry.oldPrice != null ? `${formatCurrency(entry.oldPrice, currency)} → ${formatCurrency(entry.newPrice, currency)}` : formatCurrency(entry.newPrice, currency)}</Typography>
                <Typography variant="caption" color="text.secondary">{entry.changedBy}{entry.reason ? ` · ${entry.reason}` : ''}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">{formatDateTime(entry.createdAt)}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
    )}
  </Card>
);

export const ProductTimelineCard: React.FC<{ product: Product; listing?: Listing }> = ({ product, listing }) => {
  const events = [
    { key: 'updated', label: 'Product updated', at: product.updatedAt },
    ...(listing?.lastSyncAt ? [{ key: 'synced', label: 'Marketplace status and data synced', at: listing.lastSyncAt }] : []),
    ...(listing?.publishedAt ? [{ key: 'published', label: 'Listing published to marketplace', at: listing.publishedAt }] : []),
    { key: 'created', label: 'Product created', at: product.createdAt },
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <Card title="Timeline & activity" subtitle="Recorded product and listing activity">
      <Stack spacing={0}>
        {events.map((event, index) => (
          <Stack key={event.key} direction="row" spacing={1.5}>
            <Stack sx={{ alignItems: 'center' }}><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: index === 0 ? 'primary.main' : 'text.disabled', mt: 0.5 }} />{index < events.length - 1 && <Box sx={{ width: 2, minHeight: 42, flexGrow: 1, bgcolor: 'divider' }} />}</Stack>
            <Box sx={{ pb: 2 }}><Typography variant="body2" sx={{ fontWeight: 600 }}>{event.label}</Typography><Typography variant="caption" color="text.secondary">{formatDateTime(event.at)}</Typography></Box>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
};
