// Products catalogue: server-driven filters/sort (RTK Query) + a client search,
// paginated table, and a "New product" wizard modal.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TablePagination,
  TextField,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import type { BlockerFunction } from 'react-router-dom';
import type { Marketplace, Product, ProductStatus } from '@shared/types';
import { PRODUCT_STATUS_LIST } from '@shared/constants';
import {
  useCreateProduct,
  useGenerateProductAIDraft,
  useUploadProductImage,
  useDeleteProductImage,
  useCheckMarketplace,
  useMarketplaces,
  useProducts,
} from '../services/hooks/index.js';
import type { ProductListParams } from '../state/api/index.js';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { Card } from '../components/common/Card.js';
import { Modal } from '../components/common/Modal.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { ProductStatusBadge } from '../components/common/Badge.js';
import { ProductsTable } from '../components/tables/index.js';
import {
  ProductWizardForm,
  hasMeaningfulProductWizardDraft,
  productWizardDraftStorageKey,
  readProductWizardDraft,
  removeProductWizardDraft,
  verifyWizardMarketplaceReadiness,
  writeProductWizardDraft,
} from '../components/forms/index.js';
import type {
  ProductSubmissionValues,
  ProductWizardDraftState,
} from '../components/forms/index.js';

const PAGE_SIZE = 20;

export function shouldBlockProductWizardNavigation(
  wizardOpen: boolean,
  draftDirty: boolean,
  navigationAllowed: boolean,
  currentUrl: string,
  nextUrl: string
): boolean {
  return wizardOpen && draftDirty && !navigationAllowed && currentUrl !== nextUrl;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

const ProductsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const workspaceId = useAppSelector((s) => s.workspace.id);
  const userId = useAppSelector((s) => s.auth.user?.id);
  const currency = useAppSelector((s) => s.workspace.currency);

  const [statusFilter, setStatusFilter] = useState<ProductStatus[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState<string>('');
  const [priceMax, setPriceMax] = useState<string>('');
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [search, setSearch] = useState(() => query.get('search') ?? '');
  const [sort, setSort] = useState(() => query.get('sort') ?? '-updatedAt');
  const [page, setPage] = useState(() =>
    Math.max(0, Number.parseInt(query.get('page') ?? '1', 10) - 1 || 0)
  );
  const wizardOpen = query.get('newProduct') === '1';
  const draftKey = useMemo(
    () => (workspaceId && userId ? productWizardDraftStorageKey(workspaceId, userId) : null),
    [userId, workspaceId]
  );
  const [initialDraft, setInitialDraft] = useState<ProductWizardDraftState | null>(null);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const draftLoaded = Boolean(draftKey) && loadedDraftKey === draftKey;
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const allowWizardNavigationRef = useRef(false);
  const shouldBlockWizardNavigation = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      shouldBlockProductWizardNavigation(
        wizardOpen,
        draftDirty,
        allowWizardNavigationRef.current,
        `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`,
        `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`
      ),
    [draftDirty, wizardOpen]
  );
  const blocker = useBlocker(shouldBlockWizardNavigation);

  const readStoredDraft = useCallback(() => {
    return draftKey ? readProductWizardDraft(browserStorage(), draftKey) : null;
  }, [draftKey]);

  const clearStoredDraft = useCallback(() => {
    return draftKey ? removeProductWizardDraft(browserStorage(), draftKey) : false;
  }, [draftKey]);

  const openWizard = () => {
    if (!draftKey) {
      dispatch(
        enqueueToast({
          message: 'Product creation needs an active signed-in workspace.',
          severity: 'warning',
        })
      );
      return;
    }
    allowWizardNavigationRef.current = false;
    const restored = draftKey ? readStoredDraft() : null;
    setInitialDraft(restored);
    setLoadedDraftKey(draftKey);
    setDraftDirty(Boolean(restored && hasMeaningfulProductWizardDraft(restored)));
    setDraftSaveError(false);
    navigate('/products?newProduct=1');
  };
  const closeWizard = useCallback(() => navigate('/products', { replace: true }), [navigate]);

  const params = useMemo<ProductListParams>(() => {
    const p: ProductListParams = { sort, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (statusFilter.length) p.status = statusFilter;
    if (tags.length) p.tags = tags;
    if (priceMin.trim() !== '' && !Number.isNaN(Number(priceMin))) p.priceMin = Number(priceMin);
    if (priceMax.trim() !== '' && !Number.isNaN(Number(priceMax))) p.priceMax = Number(priceMax);
    return p;
  }, [statusFilter, tags, priceMin, priceMax, sort, page]);

  const { data, isLoading, isFetching, isError, error, refetch } = useProducts(params);
  const marketplaces = useMarketplaces();
  const [checkMarketplace] = useCheckMarketplace();
  const [verifiedMarketplaces, setVerifiedMarketplaces] = useState<Marketplace[]>();
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState(false);
  const [createProduct, { isLoading: creating }] = useCreateProduct();
  const [generateProductAIDraft] = useGenerateProductAIDraft();
  const [uploadProductImage] = useUploadProductImage();
  const [deleteProductImage] = useDeleteProductImage();

  useEffect(() => {
    if (blocker.state === 'blocked') setLeaveDialogOpen(true);
  }, [blocker.state]);

  useEffect(() => {
    if (wizardOpen && !draftLoaded && draftKey) {
      const restored = readStoredDraft();
      setInitialDraft(restored);
      setDraftDirty(Boolean(restored && hasMeaningfulProductWizardDraft(restored)));
      setDraftSaveError(false);
      setLoadedDraftKey(draftKey);
    } else if (!wizardOpen && loadedDraftKey !== null) {
      setInitialDraft(null);
      setDraftDirty(false);
      setDraftSaveError(false);
      setLoadedDraftKey(null);
      setLeaveDialogOpen(false);
      allowWizardNavigationRef.current = false;
    }
  }, [draftKey, draftLoaded, loadedDraftKey, readStoredDraft, wizardOpen]);

  useEffect(() => {
    if (!wizardOpen || !draftDirty) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [draftDirty, wizardOpen]);

  const handleDraftChange = useCallback(
    (draft: ProductWizardDraftState) => {
      const meaningful = hasMeaningfulProductWizardDraft(draft);
      setDraftDirty(meaningful);
      const storage = browserStorage();
      if (!draftKey) {
        setDraftSaveError(meaningful);
        return;
      }
      const saved = meaningful
        ? writeProductWizardDraft(storage, draftKey, draft)
        : removeProductWizardDraft(storage, draftKey);
      setDraftSaveError(!saved);
    },
    [draftKey]
  );

  const completeWizardNavigation = () => {
    allowWizardNavigationRef.current = true;
    setLeaveDialogOpen(false);
    if (blocker.state === 'blocked') blocker.proceed();
    else closeWizard();
  };

  const requestWizardClose = () => {
    if (draftDirty) setLeaveDialogOpen(true);
    else completeWizardNavigation();
  };

  const cancelWizardLeave = () => {
    allowWizardNavigationRef.current = false;
    if (blocker.state === 'blocked') blocker.reset();
    setLeaveDialogOpen(false);
  };

  const keepDraftAndClose = () => {
    if (draftSaveError) {
      dispatch(
        enqueueToast({
          message: 'Draft is kept for this browser session, but will not survive a reload.',
          severity: 'warning',
        })
      );
    }
    completeWizardNavigation();
  };

  const discardDraftAndClose = () => {
    if (draftKey && !clearStoredDraft()) {
      dispatch(
        enqueueToast({
          message: 'Draft discarded for this session; an inaccessible stored copy may remain.',
          severity: 'warning',
        })
      );
    }
    setInitialDraft(null);
    setDraftDirty(false);
    setDraftSaveError(false);
    completeWizardNavigation();
  };

  useEffect(() => {
    let cancelled = false;
    if (!wizardOpen) {
      setVerifiedMarketplaces(undefined);
      setReadinessLoading(false);
      setReadinessError(false);
      return () => {
        cancelled = true;
      };
    }
    if (!marketplaces.data) {
      setVerifiedMarketplaces(undefined);
      setReadinessLoading(marketplaces.isLoading);
      setReadinessError(marketplaces.isError);
      return () => {
        cancelled = true;
      };
    }

    setVerifiedMarketplaces(undefined);
    setReadinessLoading(true);
    setReadinessError(false);
    void verifyWizardMarketplaceReadiness(marketplaces.data, (id) => checkMarketplace(id).unwrap())
      .then((result) => {
        if (cancelled) return;
        setVerifiedMarketplaces(result.marketplaces);
        setReadinessError(
          result.hadCheckError && !result.marketplaces.some((marketplace) => marketplace.connected)
        );
      })
      .catch(() => {
        if (!cancelled) setReadinessError(true);
      })
      .finally(() => {
        if (!cancelled) setReadinessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    checkMarketplace,
    marketplaces.data,
    marketplaces.isError,
    marketplaces.isLoading,
    wizardOpen,
  ]);

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p: Product) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [items, search]);

  const handleStatusChange = (e: SelectChangeEvent<ProductStatus[]>) => {
    const value = e.target.value;
    setStatusFilter(typeof value === 'string' ? (value.split(',') as ProductStatus[]) : value);
    setPage(0);
  };

  const handleCreate = async (values: ProductSubmissionValues) => {
    if (!workspaceId) {
      dispatch(enqueueToast({ message: 'No active workspace selected.', severity: 'error' }));
      return;
    }
    try {
      const { targetMarketplace: _targetMarketplace, ...productValues } = values;
      await createProduct({ ...productValues, workspaceId }).unwrap();
      if (draftKey && !clearStoredDraft()) {
        dispatch(
          enqueueToast({
            message: 'Product created, but the local wizard draft could not be cleared.',
            severity: 'warning',
          })
        );
      }
      setDraftDirty(false);
      setInitialDraft(null);
      dispatch(enqueueToast({ message: 'Product created.', severity: 'success' }));
      completeWizardNavigation();
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  return (
    <Box>
      <Card sx={{ mb: 2.5 }} contentSx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', md: 'center' }}
          flexWrap="wrap"
          useFlexGap
        >
          <TextField
            size="small"
            placeholder="Search name or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 220, flexGrow: 1 }}
          />
          <Select
            size="small"
            multiple
            displayEmpty
            value={statusFilter}
            onChange={handleStatusChange}
            renderValue={(selected) =>
              selected.length === 0 ? (
                'All statuses'
              ) : (
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {selected.map((s) => (
                    <ProductStatusBadge key={s} status={s} />
                  ))}
                </Stack>
              )
            }
            sx={{ minWidth: 180 }}
          >
            {PRODUCT_STATUS_LIST.map((s) => (
              <MenuItem key={s} value={s}>
                <ProductStatusBadge status={s} />
              </MenuItem>
            ))}
          </Select>
          <TextField
            size="small"
            type="number"
            label="Min price"
            value={priceMin}
            onChange={(e) => {
              setPriceMin(e.target.value);
              setPage(0);
            }}
            sx={{ width: 120 }}
          />
          <TextField
            size="small"
            type="number"
            label="Max price"
            value={priceMax}
            onChange={(e) => {
              setPriceMax(e.target.value);
              setPage(0);
            }}
            sx={{ width: 120 }}
          />
          <Autocomplete
            multiple
            freeSolo
            size="small"
            options={[]}
            value={tags}
            onChange={(_e, next) => {
              setTags(next as string[]);
              setPage(0);
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} />
              ))
            }
            renderInput={(p) => <TextField {...p} label="Tags" />}
            sx={{ minWidth: 200, flexGrow: 1 }}
          />
        </Stack>
      </Card>

      <Card disablePadding>
        <ProductsTable
          products={filtered}
          loading={isLoading || isFetching}
          error={isError ? error : undefined}
          onRetry={refetch}
          currency={currency}
          sort={sort}
          onSortChange={(next) => {
            setSort(next);
            setPage(0);
          }}
          onRowClick={(p) => navigate(`/products/${p.id}`)}
          onEdit={(p) => navigate(`/products/${p.id}`)}
          emptyAction={
            <Button variant="contained" startIcon={<AddIcon />} onClick={openWizard}>
              New product
            </Button>
          }
        />
        {(data?.total ?? 0) > 0 && (
          <TablePagination
            component="div"
            count={data?.total ?? 0}
            page={page}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[PAGE_SIZE]}
          />
        )}
      </Card>

      <Modal
        open={wizardOpen}
        onClose={requestWizardClose}
        title="New product"
        subtitle="Add a product to your catalogue in a few steps."
        maxWidth="md"
      >
        {!draftKey ? (
          <Alert severity="warning">
            Product creation needs an active signed-in workspace. Finish account setup or select a
            workspace, then try again.
          </Alert>
        ) : draftLoaded ? (
          <ProductWizardForm
            initialDraft={initialDraft}
            onDraftChange={handleDraftChange}
            submitting={creating}
            marketplaces={verifiedMarketplaces}
            marketplacesLoading={readinessLoading}
            marketplacesError={readinessError}
            onSubmit={handleCreate}
            onGenerateAIDraft={(request) => generateProductAIDraft(request).unwrap()}
            onUploadImage={(file) => uploadProductImage(file).unwrap()}
            onDeleteImage={async (imageId) => {
              await deleteProductImage(imageId).unwrap();
            }}
            onCancel={requestWizardClose}
          />
        ) : (
          <Alert severity="info">Loading your saved product draft…</Alert>
        )}
      </Modal>
      <ConfirmDialog
        open={leaveDialogOpen}
        title="Leave product creation?"
        message={
          draftSaveError
            ? 'This draft is available for the current browser session, but local storage failed. Reloading or closing the tab may lose it.'
            : 'Your progress is saved locally. Keep the draft for later or discard it.'
        }
        cancelLabel="Keep editing"
        alternateLabel="Save draft and close"
        confirmLabel="Discard draft"
        confirmColor="error"
        onCancel={cancelWizardLeave}
        onAlternate={keepDraftAndClose}
        onConfirm={discardDraftAndClose}
      />
    </Box>
  );
};

export default ProductsPage;
