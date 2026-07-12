// Products catalogue: server-driven filters/sort (RTK Query) + a client search,
// paginated table, and a "New product" wizard modal.
import React, { useMemo, useState } from 'react';
import {
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
import { useNavigate } from 'react-router-dom';
import type { Product, ProductStatus } from '@shared/types';
import { PRODUCT_STATUS_LIST } from '@shared/constants';
import { useCreateProduct, useProducts } from '../services/hooks/index.js';
import type { ProductListParams } from '../state/api/index.js';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { Card } from '../components/common/Card.js';
import { Modal } from '../components/common/Modal.js';
import { ProductStatusBadge } from '../components/common/Badge.js';
import { ProductsTable } from '../components/tables/index.js';
import { ProductWizardForm } from '../components/forms/index.js';
import type { ProductFormValues } from '../components/forms/index.js';

const PAGE_SIZE = 20;

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

const ProductsPage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const workspaceId = useAppSelector((s) => s.workspace.id);
  const currency = useAppSelector((s) => s.workspace.currency);

  const [statusFilter, setStatusFilter] = useState<ProductStatus[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState<string>('');
  const [priceMax, setPriceMax] = useState<string>('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('-updatedAt');
  const [page, setPage] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);

  const params = useMemo<ProductListParams>(() => {
    const p: ProductListParams = { sort, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (statusFilter.length) p.status = statusFilter;
    if (tags.length) p.tags = tags;
    if (priceMin.trim() !== '' && !Number.isNaN(Number(priceMin))) p.priceMin = Number(priceMin);
    if (priceMax.trim() !== '' && !Number.isNaN(Number(priceMax))) p.priceMax = Number(priceMax);
    return p;
  }, [statusFilter, tags, priceMin, priceMax, sort, page]);

  const { data, isLoading, isFetching, isError, error, refetch } = useProducts(params);
  const [createProduct, { isLoading: creating }] = useCreateProduct();

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p: Product) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  }, [items, search]);

  const handleStatusChange = (e: SelectChangeEvent<ProductStatus[]>) => {
    const value = e.target.value;
    setStatusFilter(typeof value === 'string' ? (value.split(',') as ProductStatus[]) : value);
    setPage(0);
  };

  const handleCreate = async (values: ProductFormValues) => {
    if (!workspaceId) {
      dispatch(enqueueToast({ message: 'No active workspace selected.', severity: 'error' }));
      return;
    }
    try {
      await createProduct({ ...values, workspaceId }).unwrap();
      dispatch(enqueueToast({ message: 'Product created.', severity: 'success' }));
      setWizardOpen(false);
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  return (
    <Box>
      <PageHeader
        title="Products"
        subtitle="Manage your catalogue across every marketplace."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setWizardOpen(true)}>
            New product
          </Button>
        }
      />

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
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setWizardOpen(true)}>
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
        onClose={() => setWizardOpen(false)}
        title="New product"
        subtitle="Add a product to your catalogue in a few steps."
        maxWidth="md"
      >
        <ProductWizardForm
          submitting={creating}
          onSubmit={handleCreate}
          onCancel={() => setWizardOpen(false)}
        />
      </Modal>
    </Box>
  );
};

export default ProductsPage;
