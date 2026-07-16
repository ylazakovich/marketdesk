// Product / listing detail: gallery, attributes, per-marketplace listings,
// price editing (PricingForm), publish + relist actions, and price history.
import React, { useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Stack, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/EditOutlined';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams } from 'react-router-dom';
import type { HermesEvent, Listing, Marketplace } from '@shared/types';
import type { PublishListingPreview } from '../state/api/dto.js';
import {
  useProduct,
  useProductListings,
  useUpdateProduct,
  useUpdateListing,
  useRelistListing,
  usePublishListingPreview,
  usePublishListing,
  useCreateProductListing,
  usePriceHistory,
  useHermesEvents,
} from '../services/hooks/index.js';
import { useMarketplaceLookup } from '../hooks/useMarketplaceLookup.js';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { formatCurrency, formatDateTime } from '../utils/formatters.js';
import { conditionLabel } from '../utils/labels.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { Card } from '../components/common/Card.js';
import { Modal } from '../components/common/Modal.js';
import { ProductStatusBadge } from '../components/common/Badge.js';
import { ErrorRetry } from '../components/common/ErrorRetry.js';
import { LoadingSkeleton } from '../components/common/Skeleton.js';
import { ListingsTable } from '../components/tables/index.js';
import { ProductForm } from '../components/forms/index.js';
import type { ProductFormValues } from '../components/forms/index.js';
import { PricingForm } from '../components/forms/index.js';
import { HermesEventCard } from '../components/hermes/index.js';

export const mainPreviewImageSx = {
  display: 'block',
  width: 'auto',
  height: 'auto',
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  margin: 'auto',
} as const;

export function remoteMarketplaceChipColor(
  listing: Listing | undefined,
): 'default' | 'success' | 'warning' | 'error' {
  if (!listing) return 'default';
  const status = listing.remoteStatus?.toLowerCase();
  if (
    listing.isRemotePending ||
    ['new', 'moderation', 'pending', 'limited', 'unpaid'].includes(status ?? '')
  ) {
    return 'warning';
  }
  if (['active', 'activated', 'live', 'published'].includes(status ?? '')) return 'success';
  if (['error', 'rejected', 'blocked'].includes(status ?? '')) return 'error';
  return 'default';
}

export function selectPrimaryListing(
  listings: Listing[],
  marketplaces: Marketplace[] | undefined,
): Listing | undefined {
  const olxMarketplaceIds = new Set(
    marketplaces?.filter((marketplace) => marketplace.key === 'olx').map(({ id }) => id) ?? [],
  );
  return listings.find((listing) => olxMarketplaceIds.has(listing.marketplaceId)) ?? listings[0];
}

export function remoteMarketplacePresentation(listing: Listing | undefined, marketplaceName: string) {
  const label = listing?.remoteStatusLabel;
  const isPending = listing?.isRemotePending === true;
  return {
    title: `${marketplaceName} listing`,
    status: label
      ? `${label} on ${marketplaceName}`
      : isPending
        ? `Pending on ${marketplaceName}`
        : `Not synced with ${marketplaceName}`,
    explanation: isPending
      ? `${marketplaceName} is still moderating or activating this listing. Metrics may be unavailable until it becomes active.`
      : label
        ? `Current listing status reported by ${marketplaceName}. This is separate from the product status in MarketDesk.`
        : `${marketplaceName} has not reported a listing status yet.`,
    externalUrl: listing?.externalUrl,
  };
}

export function selectProductRecommendations(events: HermesEvent[], productId: string): HermesEvent[] {
  return events.filter((event) => event.productId === productId && event.status === 'pending_review');
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

const DetailRow: React.FC<{ label: string; children: React.ReactNode; strong?: boolean }> = ({
  label,
  children,
  strong = false,
}) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: { xs: '1fr', sm: 'minmax(120px, max-content) minmax(0, 1fr)' },
      gap: { xs: 0.25, sm: 2 },
      alignItems: 'baseline',
    }}
  >
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}
    >
      {label}
    </Typography>
    <Typography
      variant="body2"
      sx={{ fontWeight: strong ? 700 : 500, minWidth: 0, overflowWrap: 'anywhere' }}
    >
      {children}
    </Typography>
  </Box>
);

const ListingDetailsPage: React.FC = () => {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const currency = useAppSelector((s) => s.workspace.currency);

  const product = useProduct(productId, { skip: !productId });
  const listings = useProductListings(productId, { skip: !productId });
  const hermesEvents = useHermesEvents(
    { productId, status: ['pending_review'], sort: '-createdAt', limit: 20 },
    { skip: !productId },
  );
  const { marketplaces, resolveMarketplaceName } = useMarketplaceLookup();

  const [updateProduct, { isLoading: updating }] = useUpdateProduct();
  const [updateListing, { isLoading: pricing }] = useUpdateListing();
  const [relistListing] = useRelistListing();
  const [publishListingPreview] = usePublishListingPreview();
  const [publishListing] = usePublishListing();
  const [createListing, { isLoading: creatingListing }] = useCreateProductListing();

  const [editOpen, setEditOpen] = useState(false);
  const [priceListing, setPriceListing] = useState<Listing | null>(null);
  const [publishCandidate, setPublishCandidate] = useState<{
    listing: Listing;
    preview: PublishListingPreview;
  } | null>(null);
  const [activeImage, setActiveImage] = useState(0);

  const listingItems = listings.data ?? [];
  const listingMarketplaceIds = new Set(listingItems.map((listing) => listing.marketplaceId));
  const availableMarketplace =
    !listings.isLoading && !listings.isError
      ? marketplaces?.find(
          (marketplace) => marketplace.connected && !listingMarketplaceIds.has(marketplace.id)
        )
      : undefined;
  const primaryListing = selectPrimaryListing(listingItems, marketplaces);
  const priceHistory = usePriceHistory(primaryListing?.id ?? '', { skip: !primaryListing });
  const primaryMarketplaceName = primaryListing
    ? resolveMarketplaceName(primaryListing.marketplaceId)
    : 'Marketplace';
  const remoteMarketplace = remoteMarketplacePresentation(primaryListing, primaryMarketplaceName);
  const recommendations = selectProductRecommendations(hermesEvents.data?.items ?? [], productId);

  const refreshAfterRecommendation = async () => {
    await Promise.all([hermesEvents.refetch(), product.refetch(), listings.refetch()]);
  };

  const handleEdit = async (values: ProductFormValues) => {
    try {
      await updateProduct({ id: productId, patch: values }).unwrap();
      dispatch(enqueueToast({ message: 'Product updated.', severity: 'success' }));
      setEditOpen(false);
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleUpdatePrice = async (price: number) => {
    if (!priceListing) return;
    try {
      await updateListing({ id: priceListing.id, patch: { price } }).unwrap();
      dispatch(enqueueToast({ message: 'Listing price updated.', severity: 'success' }));
      setPriceListing(null);
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleCreateListing = async () => {
    if (!availableMarketplace) return;
    try {
      await createListing({
        productId,
        marketplaceKey: availableMarketplace.key,
      }).unwrap();
      dispatch(
        enqueueToast({
          message: `${availableMarketplace.name} listing created.`,
          severity: 'success',
        })
      );
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleRelist = async (listing: Listing) => {
    try {
      await relistListing(listing.id).unwrap();
      dispatch(enqueueToast({ message: 'Listing relisted.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handlePublish = async (listing: Listing) => {
    try {
      const preview = await publishListingPreview(listing.id).unwrap();
      if (!preview.canPublish) {
        dispatch(enqueueToast({ message: preview.warnings.join('; '), severity: 'warning' }));
        return;
      }
      setPublishCandidate({ listing, preview });
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleConfirmPublish = async () => {
    if (!publishCandidate) return;
    try {
      await publishListing({ id: publishCandidate.listing.id }).unwrap();
      dispatch(enqueueToast({ message: 'Listing published.', severity: 'success' }));
      setPublishCandidate(null);
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  if (product.isError) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/products')} sx={{ mb: 2 }}>
          Back to products
        </Button>
        <ErrorRetry error={product.error} onRetry={product.refetch} />
      </Box>
    );
  }

  if (product.isLoading || !product.data) {
    return <LoadingSkeleton lines={8} />;
  }

  const p = product.data;
  const images = p.images ?? [];
  const selectedImageIndex = images.length > 0 ? Math.min(activeImage, images.length - 1) : 0;

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/products')} sx={{ mb: 1 }}>
        Back to products
      </Button>
      <PageHeader
        title={p.name}
        subtitle={p.sku}
        actions={
          <Stack direction="row" spacing={1.5} alignItems="center">
            <ProductStatusBadge status={p.status} />
            <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          </Stack>
        }
      />

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          alignItems: 'start',
        }}
      >
        <Card title="Media & details">
          <Box
            sx={{
              width: '100%',
              aspectRatio: '16 / 10',
              borderRadius: 2,
              overflow: 'hidden',
              bgcolor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {images.length > 0 ? (
              <Box
                component="img"
                src={images[selectedImageIndex]}
                alt={p.name}
                sx={mainPreviewImageSx}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                No images
              </Typography>
            )}
          </Box>
          {images.length > 1 && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, overflowX: 'auto' }}>
              {images.map((img, i) => (
                <Box
                  key={img + i}
                  component="img"
                  src={img}
                  alt=""
                  onClick={() => setActiveImage(i)}
                  sx={{
                    width: 64,
                    height: 64,
                    borderRadius: 1.5,
                    objectFit: 'cover',
                    cursor: 'pointer',
                    border: (t) =>
                      `2px solid ${i === selectedImageIndex ? t.palette.primary.main : 'transparent'}`,
                  }}
                />
              ))}
            </Stack>
          )}

          <Divider sx={{ my: 2 }} />
          <Stack spacing={1.25}>
            <DetailRow label="Condition">{conditionLabel(p.condition)}</DetailRow>
            <DetailRow label="Category">{p.category || '—'}</DetailRow>
            <DetailRow label="Cost">{formatCurrency(p.costPrice, currency)}</DetailRow>
            <DetailRow label="Selling price" strong>
              {formatCurrency(p.sellingPrice, currency)}
            </DetailRow>
          </Stack>

          {p.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
              {p.tags.map((tag) => (
                <Chip key={tag} size="small" variant="outlined" label={tag} />
              ))}
            </Stack>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>
            {p.description}
          </Typography>
        </Card>

        <Stack spacing={2.5}>
          <Card title="Pricing / status summary">
            <Typography variant="h4" sx={{ fontWeight: 800 }}>{formatCurrency(p.sellingPrice, currency)}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Cost {formatCurrency(p.costPrice, currency)} · Profit {formatCurrency(p.sellingPrice - (p.costPrice ?? 0), currency)}
            </Typography>
          </Card>

          <Card title="Statistics">
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {[
                ['Views', primaryListing?.views ?? '—'],
                ['Watchers', primaryListing?.watchers ?? '—'],
                ['Messages', primaryListing?.messages ?? '—'],
                ['Conversion', primaryListing?.views ? `${Math.round(((primaryListing.messages ?? 0) / primaryListing.views) * 100)}%` : '—'],
              ].map(([label, value]) => (
                <Box key={label} sx={{ minWidth: 96, p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>{value}</Typography>
                </Box>
              ))}
            </Stack>
          </Card>

          <Card title={remoteMarketplace.title}>
            <Chip
              size="small"
              label={remoteMarketplace.status}
              color={remoteMarketplaceChipColor(primaryListing)}
              variant="outlined"
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {primaryListing
                ? remoteMarketplace.explanation
                : 'Create or publish a marketplace listing to start tracking its provider status.'}
            </Typography>
            {primaryListing?.lastSyncAt && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Last checked: {formatDateTime(primaryListing.lastSyncAt)}
              </Typography>
            )}
            {remoteMarketplace.externalUrl && (
              <Button
                component="a"
                href={remoteMarketplace.externalUrl}
                target="_blank"
                rel="noreferrer"
                size="small"
                sx={{ mt: 1, px: 0 }}
              >
                Open on {primaryMarketplaceName}
              </Button>
            )}
          </Card>

          <Card
            title="Marketplace listings"
            action={
              availableMarketplace ? (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  disabled={creatingListing}
                  onClick={handleCreateListing}
                >
                  Create {availableMarketplace.name} listing
                </Button>
              ) : undefined
            }
            disablePadding
          >
            <ListingsTable
              listings={listingItems}
              loading={listings.isLoading}
              error={listings.isError ? listings.error : undefined}
              onRetry={listings.refetch}
              currency={currency}
              resolveMarketplaceName={resolveMarketplaceName}
              onRowClick={(l) => setPriceListing(l)}
              onRelist={handleRelist}
              onPublish={handlePublish}
            />
          </Card>

          <Card title="Hermes recommendations">
            {hermesEvents.isLoading || hermesEvents.isFetching ? (
              <LoadingSkeleton lines={2} height={96} />
            ) : hermesEvents.isError ? (
              <ErrorRetry error={hermesEvents.error} onRetry={hermesEvents.refetch} />
            ) : recommendations.length === 0 ? (
              <Alert severity="info">No pending recommendations for this product.</Alert>
            ) : (
              <Stack spacing={1.5}>
                {recommendations.map((event) => (
                  <HermesEventCard
                    key={event.id}
                    event={event}
                    onResolved={refreshAfterRecommendation}
                    approveLabel="Apply"
                    successMessage={
                      primaryListing?.status === 'live' && primaryListing.marketplaceListingId
                        ? 'Suggestion applied. Connected live listings update in the background.'
                        : 'Suggestion applied to the product.'
                    }
                  />
                ))}
                <Typography variant="caption" color="text.secondary">
                  Applying updates the product immediately. Connected live listings are then updated through the marketplace job queue.
                </Typography>
              </Stack>
            )}
          </Card>

          <Card title="Activity log">
            <Stack spacing={1}>
              <Typography variant="body2">Product updated · {formatDateTime(p.updatedAt)}</Typography>
              {primaryListing?.publishedAt && <Typography variant="body2">Published to marketplace · {formatDateTime(primaryListing.publishedAt)}</Typography>}
              {primaryListing?.lastSyncAt && <Typography variant="body2">Marketplace synced · {formatDateTime(primaryListing.lastSyncAt)}</Typography>}
            </Stack>
          </Card>

          <Card title="Price history">
            {!primaryListing ? (
              <Typography variant="body2" color="text.secondary">
                No listings yet.
              </Typography>
            ) : priceHistory.isLoading ? (
              <LoadingSkeleton lines={3} height={32} />
            ) : (priceHistory.data?.length ?? 0) === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No price changes recorded yet.
              </Typography>
            ) : (
              <Stack divider={<Divider />}>
                {priceHistory.data?.map((entry) => (
                  <Stack
                    key={entry.id}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={2}
                    sx={{ py: 1 }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {entry.oldPrice != null
                          ? `${formatCurrency(entry.oldPrice, currency)} → ${formatCurrency(entry.newPrice, currency)}`
                          : formatCurrency(entry.newPrice, currency)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {entry.changedBy}
                        {entry.reason ? ` · ${entry.reason}` : ''}
                      </Typography>
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      {formatDateTime(entry.createdAt)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Card>
        </Stack>
      </Box>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit product" maxWidth="md">
        <ProductForm
          initial={p}
          submitting={updating}
          onSubmit={handleEdit}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>

      <Modal
        open={Boolean(publishCandidate)}
        onClose={() => setPublishCandidate(null)}
        title="Confirm publish"
        subtitle={publishCandidate?.preview.marketplaceKey?.toUpperCase() ?? 'Marketplace'}
        maxWidth="xs"
        actions={
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => setPublishCandidate(null)}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleConfirmPublish}>
              Publish
            </Button>
          </Stack>
        }
      >
        <Stack spacing={1}>
          <Typography variant="body2">
            Publish {publishCandidate?.preview.payload?.productName ?? 'listing'} to{' '}
            {publishCandidate?.preview.marketplaceKey?.toUpperCase() ?? 'marketplace'}?
          </Typography>
          {publishCandidate?.preview.payload && (
            <>
              <Typography variant="body2" color="text.secondary">
                Price: {publishCandidate.preview.payload.price}{' '}
                {publishCandidate.preview.payload.currency}
              </Typography>
              {publishCandidate.preview.marketplaceCategory && (
                <Stack spacing={0.25}>
                  <Typography variant="body2">
                    Provider category ID: {publishCandidate.preview.marketplaceCategory.providerCategoryId}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Full category path: {publishCandidate.preview.marketplaceCategory.path.join(' → ')}
                  </Typography>
                </Stack>
              )}
            </>
          )}
        </Stack>
      </Modal>

      <Modal
        open={Boolean(priceListing)}
        onClose={() => setPriceListing(null)}
        title="Update listing price"
        subtitle={priceListing ? resolveMarketplaceName(priceListing.marketplaceId) : undefined}
        maxWidth="xs"
      >
        {priceListing && (
          <PricingForm
            currentPrice={priceListing.price}
            costPrice={p.costPrice ?? undefined}
            currency={currency}
            submitting={pricing}
            onSubmit={handleUpdatePrice}
          />
        )}
      </Modal>
    </Box>
  );
};

export default ListingDetailsPage;
