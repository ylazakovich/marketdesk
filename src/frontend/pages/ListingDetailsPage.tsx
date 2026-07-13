// Product / listing detail: gallery, attributes, per-marketplace listings,
// price editing (PricingForm), publish + relist actions, and price history.
import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/EditOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams } from 'react-router-dom';
import type { Listing } from '@shared/types';
import type { PublishListingPreview } from '../state/api/dto.js';
import {
  useProduct,
  useProductListings,
  useUpdateProduct,
  useUpdateListing,
  useRelistListing,
  usePublishListingPreview,
  usePublishListing,
  usePriceHistory,
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

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

const ListingDetailsPage: React.FC = () => {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const currency = useAppSelector((s) => s.workspace.currency);

  const product = useProduct(productId, { skip: !productId });
  const listings = useProductListings(productId, { skip: !productId });
  const { resolveMarketplaceName } = useMarketplaceLookup();

  const [updateProduct, { isLoading: updating }] = useUpdateProduct();
  const [updateListing, { isLoading: pricing }] = useUpdateListing();
  const [relistListing] = useRelistListing();
  const [publishListingPreview] = usePublishListingPreview();
  const [publishListing] = usePublishListing();

  const [editOpen, setEditOpen] = useState(false);
  const [priceListing, setPriceListing] = useState<Listing | null>(null);
  const [publishCandidate, setPublishCandidate] = useState<{ listing: Listing; preview: PublishListingPreview } | null>(null);
  const [activeImage, setActiveImage] = useState(0);

  const listingItems = listings.data ?? [];
  const primaryListing = listingItems[0];
  const priceHistory = usePriceHistory(primaryListing?.id ?? '', { skip: !primaryListing });

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
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {images.length > 0 ? (
              <Box
                component="img"
                src={images[activeImage]}
                alt={p.name}
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
                      `2px solid ${i === activeImage ? t.palette.primary.main : 'transparent'}`,
                  }}
                />
              ))}
            </Stack>
          )}

          <Divider sx={{ my: 2 }} />
          <Stack spacing={1}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                Condition
              </Typography>
              <Typography variant="body2">{conditionLabel(p.condition)}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                Category
              </Typography>
              <Typography variant="body2">{p.category || '—'}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                Cost
              </Typography>
              <Typography variant="body2">{formatCurrency(p.costPrice, currency)}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                Selling price
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {formatCurrency(p.sellingPrice, currency)}
              </Typography>
            </Stack>
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
          <Card title="Marketplace listings" disablePadding>
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
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(entry.createdAt)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Card>
        </Stack>
      </Box>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit product"
        maxWidth="md"
      >
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
            <Typography variant="body2" color="text.secondary">
              Price: {publishCandidate.preview.payload.price} {publishCandidate.preview.payload.currency}
            </Typography>
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
            costPrice={p.costPrice}
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
