// Product / listing detail: gallery, attributes, per-marketplace listings,
// price editing (PricingForm), publish + relist actions, and price history.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { HermesEvent, Listing, Marketplace, ProductCategoryProvenance } from '@shared/types';
import type { PublishListingInput, PublishListingPreview } from '../state/api/dto.js';
import {
  useProduct,
  useProductListings,
  useUpdateProduct,
  useUpdateListing,
  useRelistListing,
  useDelistListingToDraft,
  usePublishListingPreview,
  usePublishListing,
  useCreateProductListing,
  usePriceHistory,
  useHermesEvents,
} from '../services/hooks/index.js';
import { useMarketplaceLookup } from '../hooks/useMarketplaceLookup.js';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { formatDateTime } from '../utils/formatters.js';
import { Card } from '../components/common/Card.js';
import { Modal } from '../components/common/Modal.js';
import { ErrorRetry } from '../components/common/ErrorRetry.js';
import { LoadingSkeleton } from '../components/common/Skeleton.js';
import { ListingsTable } from '../components/tables/index.js';
import { ProductForm } from '../components/forms/index.js';
import type { ProductFormValues } from '../components/forms/index.js';
import { PricingForm } from '../components/forms/index.js';
import { HermesEventCard } from '../components/hermes/index.js';
import {
  mainPreviewImageSx,
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
} from '../components/product-detail/ProductDetailSections.js';

export { mainPreviewImageSx };

export const MIN_QUOTA_OVERRIDE_REASON_LENGTH = 10;
export const MAX_QUOTA_OVERRIDE_REASON_LENGTH = 500;

type CategoryConflictProvenance = Extract<ProductCategoryProvenance, { status: 'conflict' }>;

export function categoryConflictEvidenceLines(provenance: CategoryConflictProvenance): string[] {
  return [
    ...(provenance.currentSources ?? []).map(
      (source) => `Current · listing ${source.listingId} · ${source.path.join(' › ')} · ID ${source.providerCategoryId} · Taxonomy verified ${formatDateTime(source.taxonomyVerifiedAt)} · Synced ${formatDateTime(source.syncedAt)}`,
    ),
    ...provenance.candidates.map(
      (source) => `Candidate · listing ${source.listingId} · ${source.path.join(' › ')} · ID ${source.providerCategoryId} · Taxonomy verified ${formatDateTime(source.taxonomyVerifiedAt)} · Synced ${formatDateTime(source.syncedAt)}`,
    ),
  ];
}

export function buildPublishListingInput(
  listingId: string,
  preview: PublishListingPreview,
  quotaOverrideAccepted: boolean,
  quotaOverrideReason: string,
): PublishListingInput | null {
  if (preview.canPublish) return { id: listingId };
  const reason = quotaOverrideReason.trim();
  if (
    !preview.quotaOverrideEligibility.eligible ||
    !quotaOverrideAccepted ||
    reason.length < MIN_QUOTA_OVERRIDE_REASON_LENGTH ||
    reason.length > MAX_QUOTA_OVERRIDE_REASON_LENGTH
  ) {
    return null;
  }
  return { id: listingId, quotaOverride: { confirmed: true, reason } };
}

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


export const PublishPreviewReview: React.FC<{ preview: PublishListingPreview }> = ({ preview }) => {
  const category = preview.marketplaceCategory ?? preview.payload?.marketplaceCategory;

  return (
    <Stack spacing={1.25}>
      <Typography variant="body2">
        {preview.canPublish
          ? `Review the exact provider category before queueing ${preview.payload?.productName ?? 'this listing'} for publication.`
          : preview.quotaOverrideEligibility.eligible
            ? 'The exact provider category passed validation, but OLX free-publication quota could not be confirmed. An explicit operation-scoped fee-risk confirmation is required.'
            : 'Publication is blocked. Review the exact provider category and every blocker below; confirmation cannot override these checks.'}
      </Typography>
      {preview.payload && (
        <Typography variant="body2" color="text.secondary">
          Price: {preview.payload.price} {preview.payload.currency}
        </Typography>
      )}
      {category ? (
        <Stack spacing={0.25}>
          <Typography variant="body2">
            Provider category ID: <strong>{category.providerCategoryId}</strong>
          </Typography>
          <Typography variant="body2">
            Full category path: <strong>{category.path.join(' → ')}</strong>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Confidence: {category.confidence} · Taxonomy verified: {formatDateTime(category.taxonomyVerifiedAt)} · Stale after: {formatDateTime(category.taxonomyStaleAt)}
          </Typography>
        </Stack>
      ) : (
        <Alert severity="error">No exact provider category ID/path was returned.</Alert>
      )}
      {preview.warnings.length > 0 && (
        <Alert severity={preview.canPublish || preview.quotaOverrideEligibility.eligible ? 'warning' : 'error'}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
            {preview.canPublish
              ? 'Warnings to confirm'
              : preview.quotaOverrideEligibility.eligible
                ? 'Quota confirmation required'
                : 'Blocking reasons'}
          </Typography>
          <Box component="ul" sx={{ my: 0, pl: 2.5 }}>
            {preview.warnings.map((warning) => (
              <li key={warning}><Typography variant="body2">{warning}</Typography></li>
            ))}
          </Box>
        </Alert>
      )}
    </Stack>
  );
};

const ListingDetailsPage: React.FC = () => {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const currency = useAppSelector((s) => s.workspace.currency);

  const product = useProduct(productId, { skip: !productId });
  const listings = useProductListings(productId, { skip: !productId });
  const hermesEvents = useHermesEvents(
    { productId, status: ['pending_review'], sort: '-createdAt', limit: 20 },
    { skip: !productId },
  );
  const { marketplaces, resolveMarketplaceName, resolveMarketplaceKey } = useMarketplaceLookup();

  const [updateProduct, { isLoading: updating }] = useUpdateProduct();
  const [updateListing, { isLoading: pricing }] = useUpdateListing();
  const [relistListing, { isLoading: relisting }] = useRelistListing();
  const [delistToDraft, { isLoading: delisting }] = useDelistListingToDraft();
  const [publishListingPreview] = usePublishListingPreview();
  const [publishListing, { isLoading: publishing }] = usePublishListing();
  const [createListing, { isLoading: creatingListing }] = useCreateProductListing();

  const [editOpen, setEditOpen] = useState(false);
  const [priceListing, setPriceListing] = useState<Listing | null>(null);
  const [publishCandidate, setPublishCandidate] = useState<{
    listing: Listing;
    preview: PublishListingPreview;
    mode: 'publish' | 'relist';
  } | null>(null);
  const [quotaOverrideAccepted, setQuotaOverrideAccepted] = useState(false);
  const [quotaOverrideReason, setQuotaOverrideReason] = useState('');
  const [previewingPublication, setPreviewingPublication] = useState(false);
  const [submittingPublication, setSubmittingPublication] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const consumedNavigationReview = useRef<string | null>(null);
  const previewInFlight = useRef(false);
  const publicationReviewOpen = useRef(false);
  const submissionInFlight = useRef(false);

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
  const publicationBusy = previewingPublication || submittingPublication || publishing || relisting || delisting;
  const publicationActionsLocked = publicationBusy || Boolean(publishCandidate);

  const closePublicationReview = () => {
    if (publicationBusy || previewInFlight.current || submissionInFlight.current) return;
    publicationReviewOpen.current = false;
    setPublishCandidate(null);
    setQuotaOverrideAccepted(false);
    setQuotaOverrideReason('');
  };

  const refreshAfterRecommendation = async () => {
    await Promise.all([
      hermesEvents.refetch(),
      product.refetch(),
      listings.refetch(),
      ...(primaryListing ? [priceHistory.refetch()] : []),
    ]);
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

  const beginPublicationReview = useCallback(async (
    listing: Listing,
    mode: 'publish' | 'relist',
  ) => {
    if (
      previewInFlight.current ||
      publicationReviewOpen.current ||
      submissionInFlight.current
    ) return;
    previewInFlight.current = true;
    setPreviewingPublication(true);
    try {
      const preview = await publishListingPreview(listing.id).unwrap();
      setQuotaOverrideAccepted(false);
      setQuotaOverrideReason('');
      publicationReviewOpen.current = true;
      setPublishCandidate({ listing, preview, mode });
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    } finally {
      previewInFlight.current = false;
      setPreviewingPublication(false);
    }
  }, [dispatch, publishListingPreview]);

  const handleRelist = (listing: Listing) => void beginPublicationReview(listing, 'relist');
  const handlePublish = (listing: Listing) => void beginPublicationReview(listing, 'publish');

  const handleConfirmPublish = async () => {
    if (!publishCandidate || submissionInFlight.current) return;
    const input = buildPublishListingInput(
      publishCandidate.listing.id,
      publishCandidate.preview,
      quotaOverrideAccepted,
      quotaOverrideReason,
    );
    if (!input) return;
    submissionInFlight.current = true;
    setSubmittingPublication(true);
    try {
      if (publishCandidate.mode === 'relist') {
        await relistListing(input).unwrap();
      } else {
        await publishListing(input).unwrap();
      }
      dispatch(enqueueToast({
        message: publishCandidate.mode === 'relist'
          ? 'Republication was accepted and queued.'
          : 'Publication was accepted and queued.',
        severity: 'success',
      }));
      publicationReviewOpen.current = false;
      setPublishCandidate(null);
      setQuotaOverrideAccepted(false);
      setQuotaOverrideReason('');
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    } finally {
      submissionInFlight.current = false;
      setSubmittingPublication(false);
    }
  };

  useEffect(() => {
    const review = (location.state as {
      publicationReview?: { listingId: string; mode: 'relist' };
    } | null)?.publicationReview;
    if (!review) {
      consumedNavigationReview.current = null;
      return;
    }
    const reviewKey = `${review.mode}:${review.listingId}`;
    if (
      consumedNavigationReview.current === reviewKey ||
      publicationBusy ||
      listings.isLoading ||
      listings.isFetching ||
      listings.isError
    ) return;
    consumedNavigationReview.current = reviewKey;
    navigate(location.pathname, { replace: true, state: null });
    const listing = listingItems.find((item) => item.id === review.listingId);
    if (!listing) {
      dispatch(enqueueToast({
        message: 'Listing is no longer available for review.',
        severity: 'error',
      }));
      return;
    }
    void beginPublicationReview(listing, 'relist');
  }, [
    beginPublicationReview,
    listingItems,
    listings.isError,
    listings.isFetching,
    listings.isLoading,
    location.pathname,
    location.state,
    navigate,
    publicationBusy,
  ]);

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
      <ProductIdentityHero product={p} onEdit={() => setEditOpen(true)} />

      <Box sx={productDetailGridSx} data-testid="product-detail-layout">
        <Stack spacing={{ xs: 2, lg: 3 }} sx={{ minWidth: 0 }}>
          <ProductGalleryCard name={p.name} images={images} activeIndex={activeImage} onSelect={setActiveImage} />
          <ProductDescriptionCard product={p} onEdit={() => setEditOpen(true)} />
          <ProductCategoryEvidence
            product={p}
            conflictLines={p.categoryProvenance?.status === 'conflict'
              ? categoryConflictEvidenceLines(p.categoryProvenance)
              : []}
          />
          <Card
            title="Marketplace listings"
            action={availableMarketplace ? (
              <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={creatingListing} onClick={handleCreateListing}>
                Create {availableMarketplace.name} listing
              </Button>
            ) : undefined}
            disablePadding
          >
            <ListingsTable
              listings={listingItems}
              loading={listings.isLoading}
              error={listings.isError ? listings.error : undefined}
              onRetry={listings.refetch}
              currency={currency}
              resolveMarketplaceName={resolveMarketplaceName}
              resolveMarketplaceKey={resolveMarketplaceKey}
              onRowClick={(listing) => setPriceListing(listing)}
              onRelist={handleRelist}
              onPublish={handlePublish}
              onDelistToDraft={async (listing, operationId) => {
                const operation = await delistToDraft({
                  id: listing.id,
                  operationId,
                  confirmed: true,
                }).unwrap();
                if (operation.state === 'executed') {
                  dispatch(enqueueToast({
                    message: 'Remote advert removed; listing returned to draft. Nothing was republished.',
                    severity: 'success',
                  }));
                }
                return operation;
              }}
              actionsDisabled={publicationActionsLocked}
            />
          </Card>
          <PriceHistoryCard
            listing={primaryListing}
            history={priceHistory.data}
            loading={priceHistory.isLoading || listings.isLoading}
            error={listings.isError ? listings.error : priceHistory.isError ? priceHistory.error : undefined}
            onRetry={() => {
              if (listings.isError) void listings.refetch();
              if (priceHistory.isError) void priceHistory.refetch();
            }}
            currency={currency}
          />
          <ProductTimelineCard product={p} listing={primaryListing} />
        </Stack>

        <Stack spacing={{ xs: 2, lg: 3 }} sx={productDetailRailSx} data-testid="product-detail-rail">
          <PricingSummaryCard product={p} currency={currency} onEdit={() => setEditOpen(true)} />
          <OlxInsightsCard
            listing={primaryListing}
            loading={listings.isLoading || listings.isFetching}
            error={listings.isError ? listings.error : undefined}
            onRetry={() => { void listings.refetch(); }}
            isOlx={Boolean(primaryListing && marketplaces?.find(
              (marketplace) => marketplace.id === primaryListing.marketplaceId,
            )?.key === 'olx')}
            statusTitle={remoteMarketplace.title}
            statusLabel={remoteMarketplace.status}
            statusExplanation={primaryListing
              ? remoteMarketplace.explanation
              : 'Create or publish an OLX listing to start tracking provider status.'}
            statusColor={remoteMarketplaceChipColor(primaryListing)}
          />
          <Card
            title="Hermes recommendations"
            subtitle="Real pending recommendations for this product"
            sx={{ borderColor: 'primary.main', bgcolor: 'background.paper' }}
          >
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
                    approveLabel={event.proposedChange?.kind === 'category_recreation' ? undefined : 'Apply'}
                    successMessage={event.proposedChange?.kind === 'category_recreation'
                      ? undefined
                      : primaryListing?.status === 'live' && primaryListing.marketplaceListingId
                        ? 'Suggestion applied locally. Connected live listing updates were queued.'
                        : 'Suggestion applied to the product.'}
                  />
                ))}
                <Typography variant="caption" color="text.secondary">
                  Category correction always uses separate audited delist and recreate reviews.
                </Typography>
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
        onClose={closePublicationReview}
        closeDisabled={publicationBusy}
        title={
          publishCandidate?.preview.canPublish
            ? 'Confirm publication request'
            : publishCandidate?.preview.quotaOverrideEligibility.eligible
              ? 'Confirm possible OLX fee'
              : 'Publication review'
        }
        subtitle={publishCandidate?.preview.marketplaceKey?.toUpperCase() ?? 'Marketplace'}
        maxWidth="xs"
        actions={
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" disabled={publicationBusy} onClick={closePublicationReview}>
              Close
            </Button>
            <Button
              variant="contained"
              disabled={
                publicationBusy ||
                !publishCandidate ||
                buildPublishListingInput(
                  publishCandidate.listing.id,
                  publishCandidate.preview,
                  quotaOverrideAccepted,
                  quotaOverrideReason,
                ) === null
              }
              onClick={handleConfirmPublish}
            >
              {publishCandidate?.preview.quotaOverrideEligibility.eligible
                ? publishCandidate.mode === 'relist'
                  ? 'Accept fee risk and queue relist'
                  : 'Accept fee risk and queue publish'
                : publishCandidate?.mode === 'relist'
                  ? 'Confirm category and queue relist'
                  : 'Confirm category and queue publish'}
            </Button>
          </Stack>
        }
      >
        {publishCandidate && (
          <Stack spacing={2}>
            <PublishPreviewReview preview={publishCandidate.preview} />
            {publishCandidate.preview.quotaOverrideEligibility.eligible && (
              <Stack spacing={1}>
                <Alert severity="warning">
                  OLX may charge for this publication. This confirmation applies only to this single request.
                </Alert>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={quotaOverrideAccepted}
                      disabled={publicationBusy}
                      onChange={(event) => setQuotaOverrideAccepted(event.target.checked)}
                    />
                  }
                  label="I accept the possible OLX publication fee"
                />
                <TextField
                  label="Reason for quota override"
                  value={quotaOverrideReason}
                  disabled={publicationBusy}
                  onChange={(event) => setQuotaOverrideReason(event.target.value)}
                  required
                  multiline
                  minRows={2}
                  inputProps={{ maxLength: MAX_QUOTA_OVERRIDE_REASON_LENGTH }}
                  helperText={`${MIN_QUOTA_OVERRIDE_REASON_LENGTH}–${MAX_QUOTA_OVERRIDE_REASON_LENGTH} characters. Saved in the audit log.`}
                />
              </Stack>
            )}
          </Stack>
        )}
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
