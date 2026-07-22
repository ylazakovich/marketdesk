// Products catalogue: server-driven filters/sort (RTK Query) + a client search,
// paginated table, and a "New product" wizard modal.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TablePagination,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import GridViewIcon from '@mui/icons-material/GridView';
import ListIcon from '@mui/icons-material/ViewList';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import type { BlockerFunction } from 'react-router-dom';
import type { Marketplace, Product } from '@shared/types';
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
import { ProductsCards, ProductsTable } from '../components/tables/index.js';
import {
  hasCatalogueFilters,
  parseProductsCatalogueState,
  PRODUCTS_PAGE_SIZE,
  PRODUCT_SEARCH_DEBOUNCE_MS,
  productsToCsv,
  tabStatus,
  updateProductsCatalogueSearch,
} from './productsCatalogueState.js';
import type {
  ProductsCatalogueState,
  ProductsTab,
  ProductsView,
} from './productsCatalogueState.js';
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

export function shouldBlockProductWizardNavigation(
  wizardOpen: boolean,
  draftDirty: boolean,
  navigationAllowed: boolean,
  currentUrl: string,
  nextUrl: string
): boolean {
  return wizardOpen && draftDirty && !navigationAllowed && currentUrl !== nextUrl;
}

export function shouldDebounceCatalogueSearch(
  wizardOpen: boolean,
  searchInput: string,
  committedSearch: string
): boolean {
  return !wizardOpen && searchInput !== committedSearch;
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

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const catalogue = useMemo(() => parseProductsCatalogueState(location.search), [location.search]);
  const [searchInput, setSearchInput] = useState(catalogue.search);
  const lastUrlSearchRef = useRef(catalogue.search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const wizardOpen = query.get('newProduct') === '1';

  const navigateCatalogue = useCallback(
    (patch: Partial<ProductsCatalogueState>, replace = false) => {
      navigate(
        {
          pathname: location.pathname,
          search: updateProductsCatalogueSearch(location.search, patch),
        },
        { replace }
      );
    },
    [location.pathname, location.search, navigate]
  );

  useEffect(() => {
    if (catalogue.search === lastUrlSearchRef.current) return;
    lastUrlSearchRef.current = catalogue.search;
    setSearchInput(catalogue.search);
  }, [catalogue.search]);
  useEffect(() => {
    if (!shouldDebounceCatalogueSearch(wizardOpen, searchInput, catalogue.search)) return undefined;
    const timer = window.setTimeout(
      () => navigateCatalogue({ search: searchInput, page: 0 }, true),
      PRODUCT_SEARCH_DEBOUNCE_MS
    );
    return () => window.clearTimeout(timer);
  }, [catalogue.search, navigateCatalogue, searchInput, wizardOpen]);
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
    const next = new URLSearchParams(location.search);
    next.set('newProduct', '1');
    navigate({ pathname: location.pathname, search: `?${next.toString()}` });
  };
  const closeWizard = useCallback(() => {
    const next = new URLSearchParams(location.search);
    next.delete('newProduct');
    const search = next.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '' },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  const params = useMemo<ProductListParams>(() => {
    const p: ProductListParams = {
      sort: catalogue.sort,
      limit: PRODUCTS_PAGE_SIZE,
      offset: catalogue.page * PRODUCTS_PAGE_SIZE,
    };
    const status = tabStatus(catalogue.tab);
    if (status) p.status = status;
    if (catalogue.search.trim()) p.search = catalogue.search.trim();
    if (catalogue.tags.length) p.tags = catalogue.tags;
    if (catalogue.priceMin.trim() !== '' && !Number.isNaN(Number(catalogue.priceMin))) {
      p.priceMin = Number(catalogue.priceMin);
    }
    if (catalogue.priceMax.trim() !== '' && !Number.isNaN(Number(catalogue.priceMax))) {
      p.priceMax = Number(catalogue.priceMax);
    }
    return p;
  }, [catalogue]);

  const { currentData, isLoading, isFetching, isError, error, refetch } = useProducts(params);
  const allCount = useProducts({ limit: 1, offset: 0 });
  const activeCount = useProducts({ status: ['active'], limit: 1, offset: 0 });
  const attentionCount = useProducts({ status: ['attention'], limit: 1, offset: 0 });
  const draftCount = useProducts({ status: ['draft'], limit: 1, offset: 0 });
  const totalPages = currentData ? Math.ceil(currentData.total / PRODUCTS_PAGE_SIZE) : 0;
  const pageOutOfRange = Boolean(currentData && catalogue.page > Math.max(0, totalPages - 1));
  const paginationPage = totalPages > 0 ? Math.min(catalogue.page, totalPages - 1) : 0;
  useEffect(() => {
    if (!currentData || !pageOutOfRange) return;
    navigateCatalogue({ page: Math.max(0, totalPages - 1) }, true);
  }, [currentData, navigateCatalogue, pageOutOfRange, totalPages]);
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

  const items = useMemo<Product[]>(() => currentData?.items ?? [], [currentData?.items]);
  useEffect(() => {
    const visible = new Set(items.map((product) => product.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const selectedProducts = useMemo(
    () => items.filter((product) => selectedIds.has(product.id)),
    [items, selectedIds]
  );
  const clearFilters = () => {
    setSearchInput('');
    navigateCatalogue({ tab: 'all', search: '', tags: [], priceMin: '', priceMax: '', page: 0 });
  };
  const exportSelected = () => {
    const csv = productsToCsv(selectedProducts, currency);
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `marketdesk-products-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    dispatch(
      enqueueToast({
        message: `Exported ${selectedProducts.length} selected products.`,
        severity: 'success',
      })
    );
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
    <Box sx={{ maxWidth: 1440, mx: 'auto' }}>
      <Card sx={{ mb: 2 }} contentSx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            spacing={1.25}
            alignItems={{ xs: 'stretch', lg: 'center' }}
            useFlexGap
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={catalogue.tab}
              onChange={(_event, value: ProductsTab | null) =>
                value && navigateCatalogue({ tab: value, page: 0 })
              }
              aria-label="Product status"
              sx={{
                overflowX: 'auto',
                '& .MuiToggleButton-root': {
                  whiteSpace: 'nowrap',
                  textTransform: 'none',
                  fontWeight: 700,
                },
              }}
            >
              {(
                [
                  ['all', 'All', allCount],
                  ['active', 'Active', activeCount],
                  ['attention', 'Attention', attentionCount],
                  ['draft', 'Drafts', draftCount],
                ] as const
              ).map(([value, label, countQuery]) => (
                <ToggleButton key={value} value={value} aria-label={`${label} products`}>
                  {label}
                  <Chip
                    component="span"
                    size="small"
                    label={
                      countQuery.isLoading || countQuery.isError
                        ? '—'
                        : (countQuery.data?.total ?? 0)
                    }
                    sx={{ ml: 0.75, height: 20, pointerEvents: 'none' }}
                  />
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Box sx={{ flex: 1 }} />
            <TextField
              size="small"
              placeholder="Search name, SKU, description or tag"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              inputProps={{ 'aria-label': 'Search products' }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: { xs: 0, sm: 260 } }}
            />
            <Button
              variant={
                filtersOpen || catalogue.tags.length > 0 || catalogue.priceMin || catalogue.priceMax
                  ? 'contained'
                  : 'outlined'
              }
              color="inherit"
              startIcon={<FilterListIcon />}
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
            >
              Filters
            </Button>
            <Select
              size="small"
              value={catalogue.sort}
              onChange={(event) => navigateCatalogue({ sort: event.target.value, page: 0 })}
              inputProps={{ 'aria-label': 'Sort products' }}
              sx={{ minWidth: 165 }}
            >
              <MenuItem value="-updatedAt">Updated: newest</MenuItem>
              <MenuItem value="updatedAt">Updated: oldest</MenuItem>
              <MenuItem value="name">Name: A–Z</MenuItem>
              <MenuItem value="-name">Name: Z–A</MenuItem>
              <MenuItem value="sellingPrice">Price: low to high</MenuItem>
              <MenuItem value="-sellingPrice">Price: high to low</MenuItem>
              <MenuItem value="costPrice">Cost: low to high</MenuItem>
              <MenuItem value="-costPrice">Cost: high to low</MenuItem>
            </Select>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={catalogue.view}
              onChange={(_event, value: ProductsView | null) =>
                value && navigateCatalogue({ view: value })
              }
              aria-label="Catalogue view"
            >
              <ToggleButton value="list" aria-label="List view">
                <ListIcon />
              </ToggleButton>
              <ToggleButton value="card" aria-label="Card view">
                <GridViewIcon />
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Collapse in={filtersOpen}>
            <Divider sx={{ mb: 2 }} />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.25}
              alignItems={{ xs: 'stretch', sm: 'center' }}
            >
              <TextField
                size="small"
                type="number"
                label="Minimum price"
                value={catalogue.priceMin}
                onChange={(event) =>
                  navigateCatalogue({ priceMin: event.target.value, page: 0 }, true)
                }
                inputProps={{ min: 0 }}
              />
              <TextField
                size="small"
                type="number"
                label="Maximum price"
                value={catalogue.priceMax}
                onChange={(event) =>
                  navigateCatalogue({ priceMax: event.target.value, page: 0 }, true)
                }
                inputProps={{ min: 0 }}
              />
              <Autocomplete
                multiple
                freeSolo
                size="small"
                options={[]}
                value={catalogue.tags}
                onChange={(_event, next) => navigateCatalogue({ tags: next as string[], page: 0 })}
                renderTags={(value, getTagProps) =>
                  value.map((tag, index) => (
                    <Chip variant="outlined" size="small" label={tag} {...getTagProps({ index })} />
                  ))
                }
                renderInput={(params) => (
                  <TextField {...params} label="Tags" placeholder="Type and press Enter" />
                )}
                sx={{ minWidth: 240, flex: 1 }}
              />
              <Button onClick={clearFilters} disabled={!hasCatalogueFilters(catalogue)}>
                Clear filters
              </Button>
            </Stack>
            <Alert severity="info" sx={{ mt: 1.5 }}>
              Marketplace, margin and updated-date filters are not shown because the catalogue API
              does not expose those filters yet.
            </Alert>
          </Collapse>
        </Stack>
      </Card>

      {selectedIds.size > 0 && (
        <Box
          role="region"
          aria-label="Bulk product actions"
          sx={{
            position: 'sticky',
            top: 72,
            zIndex: 5,
            mb: 2,
            p: 1.25,
            borderRadius: 2,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            boxShadow: 4,
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', md: 'center' }}
          >
            <Typography sx={{ px: 1, fontWeight: 800 }}>
              {selectedIds.size} selected on this page
            </Typography>
            <Divider
              orientation="vertical"
              flexItem
              sx={{ borderColor: 'rgba(255,255,255,.3)', display: { xs: 'none', md: 'block' } }}
            />
            {[
              [<LocalOfferOutlinedIcon key="tag" />, 'Add tag'],
              [<EditOutlinedIcon key="price" />, 'Edit price'],
              [<DeleteOutlineIcon key="delete" />, 'Delete'],
            ].map(([icon, label]) => (
              <Tooltip
                key={String(label)}
                title="Unavailable safely: the API has no atomic bulk mutation contract or rollback semantics."
              >
                <span>
                  <Button disabled startIcon={icon} sx={{ color: 'inherit' }}>
                    {label}
                  </Button>
                </span>
              </Tooltip>
            ))}
            <Button color="inherit" startIcon={<DownloadIcon />} onClick={exportSelected}>
              Export CSV
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button color="inherit" onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </Button>
          </Stack>
          <Typography variant="caption" sx={{ display: 'block', px: 1, opacity: 0.9 }}>
            Bulk writes are disabled rather than issuing unsafe sequential requests. Single-product
            editing keeps the existing below-cost confirmation guard.
          </Typography>
        </Box>
      )}

      <Card disablePadding>
        {catalogue.view === 'list' ? (
          <ProductsTable
            products={items}
            loading={isLoading || isFetching || pageOutOfRange}
            error={isError ? error : undefined}
            onRetry={refetch}
            currency={currency}
            sort={catalogue.sort}
            onSortChange={(sort) => navigateCatalogue({ sort, page: 0 })}
            onOpen={(product) => navigate(`/products/${product.id}`)}
            onEdit={(product) => navigate(`/products/${product.id}`)}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyFiltered={hasCatalogueFilters(catalogue) || (currentData?.total ?? 0) > 0}
            clearFiltersAction={<Button onClick={clearFilters}>Clear filters</Button>}
            emptyAction={
              <Button variant="contained" startIcon={<AddIcon />} onClick={openWizard}>
                Create your first product
              </Button>
            }
          />
        ) : (
          <ProductsCards
            products={items}
            loading={isLoading || isFetching || pageOutOfRange}
            error={isError ? error : undefined}
            onRetry={refetch}
            currency={currency}
            onOpen={(product) => navigate(`/products/${product.id}`)}
            onEdit={(product) => navigate(`/products/${product.id}`)}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyFiltered={hasCatalogueFilters(catalogue) || (currentData?.total ?? 0) > 0}
            clearFiltersAction={<Button onClick={clearFilters}>Clear filters</Button>}
            emptyAction={
              <Button variant="contained" startIcon={<AddIcon />} onClick={openWizard}>
                Create your first product
              </Button>
            }
          />
        )}
        {(currentData?.total ?? 0) > 0 && (
          <TablePagination
            component="div"
            count={currentData?.total ?? 0}
            page={paginationPage}
            onPageChange={(_event, page) => navigateCatalogue({ page })}
            rowsPerPage={PRODUCTS_PAGE_SIZE}
            rowsPerPageOptions={[PRODUCTS_PAGE_SIZE]}
            labelDisplayedRows={({ from, to, count }) =>
              `${from}–${to} of ${count} products · 25 per page`
            }
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
