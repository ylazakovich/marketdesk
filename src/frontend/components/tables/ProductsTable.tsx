import React, { useState } from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  Checkbox,
  Chip,
  IconButton,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/EditOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import type { Product } from '@shared/types';
import { formatCurrency } from '../../utils/formatters.js';
import { ProductStatusBadge } from '../common/Badge.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { EmptyState } from '../common/EmptyState.js';
import { productInitials } from '../../pages/productsCatalogueState.js';

type SortDir = 'asc' | 'desc';

function parseSort(sort?: string): { field: string; dir: SortDir } | null {
  if (!sort) return null;
  const first = sort.split(',')[0]?.trim();
  if (!first) return null;
  if (first.startsWith('-')) return { field: first.slice(1), dir: 'desc' };
  if (first.startsWith('+')) return { field: first.slice(1), dir: 'asc' };
  return { field: first, dir: 'asc' };
}

function ProductThumbnail({ product }: { product: Product }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = product.images[0];
  if (image && image !== failedImage) {
    return (
      <Box
        component="img"
        src={image}
        alt=""
        onError={() => setFailedImage(image)}
        sx={{ width: 44, height: 44, borderRadius: 1.5, objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <Avatar
      variant="rounded"
      aria-label={`${product.name} image unavailable`}
      sx={{
        width: 44,
        height: 44,
        bgcolor: 'primary.light',
        color: 'primary.contrastText',
        fontWeight: 800,
      }}
    >
      {productInitials(product.name)}
    </Avatar>
  );
}

function ProductIdentity({
  product,
  onOpen,
}: {
  product: Product;
  onOpen?: (product: Product) => void;
}) {
  return (
    <ButtonBase
      disabled={!onOpen}
      onClick={() => onOpen?.(product)}
      sx={{ width: '100%', justifyContent: 'flex-start', borderRadius: 1, textAlign: 'left' }}
    >
      <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: 'center' }}>
        <ProductThumbnail product={product} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
            {product.name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ fontFamily: 'monospace' }}
          >
            {product.sku}
          </Typography>
        </Box>
      </Stack>
    </ButtonBase>
  );
}

function Profit({ product, currency }: { product: Product; currency?: string }) {
  if (product.costPrice === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }
  const profit = product.sellingPrice - product.costPrice;
  const margin = product.sellingPrice === 0 ? null : (profit / product.sellingPrice) * 100;
  return (
    <Box>
      <Typography
        variant="body2"
        color={profit < 0 ? 'error.main' : 'success.main'}
        sx={{ fontWeight: 700 }}
      >
        {formatCurrency(profit, currency)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {margin === null ? 'Margin unavailable' : `${margin.toFixed(1)}% margin`}
      </Typography>
    </Box>
  );
}

export interface ProductsCollectionProps {
  products?: Product[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onOpen?: (product: Product) => void;
  onEdit?: (product: Product) => void;
  sort?: string;
  onSortChange?: (sort: string) => void;
  currency?: string;
  emptyAction?: React.ReactNode;
  emptyFiltered?: boolean;
  clearFiltersAction?: React.ReactNode;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}

export type ProductsTableProps = ProductsCollectionProps;

function CollectionState(props: ProductsCollectionProps): React.ReactNode | null {
  if (props.error) return <ErrorRetry error={props.error} onRetry={props.onRetry} />;
  if (!props.loading && (!props.products || props.products.length === 0)) {
    return (
      <EmptyState
        icon={<Inventory2OutlinedIcon sx={{ fontSize: 52 }} />}
        title={props.emptyFiltered ? 'No products match' : 'Your catalogue is empty'}
        description={
          props.emptyFiltered
            ? 'Try clearing filters or using a broader search.'
            : 'Create your first product to start managing marketplace listings.'
        }
        action={props.emptyFiltered ? props.clearFiltersAction : props.emptyAction}
      />
    );
  }
  return null;
}

function toggleSelection(selected: ReadonlySet<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(selected);
  if (checked) next.add(id);
  else next.delete(id);
  return next;
}

export const ProductsTable: React.FC<ProductsCollectionProps> = (props) => {
  const { products = [], loading = false, selectedIds = new Set(), onSelectionChange } = props;
  const state = CollectionState(props);
  if (state) return state;
  const active = parseSort(props.sort);
  const allSelected =
    products.length > 0 && products.every((product) => selectedIds.has(product.id));
  const someSelected = products.some((product) => selectedIds.has(product.id));
  const handleSort = (field: string) => {
    const nextDir: SortDir = active?.field === field && active.dir === 'asc' ? 'desc' : 'asc';
    props.onSortChange?.(`${nextDir === 'desc' ? '-' : ''}${field}`);
  };
  const sortHeading = (label: string, field: string) => (
    <TableSortLabel
      active={active?.field === field}
      direction={active?.field === field ? active.dir : 'asc'}
      onClick={() => handleSort(field)}
    >
      {label}
    </TableSortLabel>
  );

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="medium" sx={{ minWidth: 1120 }} aria-label="Products catalogue">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                slotProps={{ input: { 'aria-label': 'Select all products on this page' } }}
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                onChange={(_event, checked) =>
                  onSelectionChange?.(
                    checked ? new Set(products.map((product) => product.id)) : new Set()
                  )
                }
              />
            </TableCell>
            <TableCell sx={{ minWidth: 250 }}>{sortHeading('Product', 'name')}</TableCell>
            <TableCell>{sortHeading('Status', 'status')}</TableCell>
            <TableCell>Markets</TableCell>
            <TableCell align="right">{sortHeading('Cost', 'costPrice')}</TableCell>
            <TableCell align="right">{sortHeading('Price', 'sellingPrice')}</TableCell>
            <TableCell>Profit</TableCell>
            <TableCell sx={{ minWidth: 160 }}>Tags</TableCell>
            <TableCell align="right">{sortHeading('Updated', 'updatedAt')}</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading
            ? Array.from({ length: 8 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: 10 }).map((__, cell) => (
                    <TableCell key={cell}>
                      <Skeleton width={cell === 1 ? 190 : 70} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : products.map((product) => (
                <TableRow key={product.id} hover selected={selectedIds.has(product.id)}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      slotProps={{ input: { 'aria-label': `Select ${product.name}` } }}
                      checked={selectedIds.has(product.id)}
                      onChange={(_event, checked) =>
                        onSelectionChange?.(toggleSelection(selectedIds, product.id, checked))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <ProductIdentity product={product} onOpen={props.onOpen} />
                  </TableCell>
                  <TableCell>
                    <ProductStatusBadge status={product.status} />
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Marketplace count is not included in the products catalogue API">
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        aria-label="Marketplace count unavailable"
                      >
                        —
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>
                    {product.costPrice === null
                      ? '—'
                      : formatCurrency(product.costPrice, props.currency)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>
                    {formatCurrency(product.sellingPrice, props.currency)}
                  </TableCell>
                  <TableCell>
                    <Profit product={product} currency={props.currency} />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {product.tags.length ? (
                        product.tags
                          .slice(0, 3)
                          .map((tag) => <Chip key={tag} label={tag} size="small" />)
                      ) : (
                        <Typography color="text.secondary">—</Typography>
                      )}
                      {product.tags.length > 3 && (
                        <Chip
                          label={`+${product.tags.length - 3}`}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {new Date(product.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell align="right">
                    {props.onEdit && (
                      <Tooltip title="Edit product">
                        <IconButton
                          size="small"
                          aria-label={`Edit ${product.name}`}
                          onClick={() => props.onEdit?.(product)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export const ProductsCards: React.FC<ProductsCollectionProps> = (props) => {
  const { products = [], loading = false, selectedIds = new Set(), onSelectionChange } = props;
  const state = CollectionState(props);
  if (state) return state;
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(3, minmax(0, 1fr))',
        },
        gap: 2,
        p: 2,
      }}
    >
      {(loading ? Array.from({ length: 8 }) : products).map((entry, index) => {
        if (!entry) return <Skeleton key={index} variant="rounded" height={210} />;
        const product = entry as Product;
        return (
          <Box
            key={product.id}
            component="article"
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2,
              bgcolor: 'background.paper',
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Checkbox
                size="small"
                slotProps={{ input: { 'aria-label': `Select ${product.name}` } }}
                checked={selectedIds.has(product.id)}
                onChange={(_event, checked) =>
                  onSelectionChange?.(toggleSelection(selectedIds, product.id, checked))
                }
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <ProductIdentity product={product} onOpen={props.onOpen} />
              </Box>
              <ProductStatusBadge status={product.status} />
              {props.onEdit && (
                <Tooltip title="Edit product">
                  <IconButton
                    size="small"
                    aria-label={`Edit ${product.name}`}
                    onClick={() => props.onEdit?.(product)}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            <Stack
              direction="row"
              spacing={0.5}
              useFlexGap
              sx={{ my: 2, minHeight: 24, flexWrap: 'wrap' }}
            >
              {product.tags.map((tag) => (
                <Chip key={tag} label={tag} size="small" />
              ))}
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 1,
                pt: 1.5,
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Cost
                </Typography>
                <Typography variant="body2">
                  {product.costPrice === null
                    ? '—'
                    : formatCurrency(product.costPrice, props.currency)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Price
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {formatCurrency(product.sellingPrice, props.currency)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Profit
                </Typography>
                <Profit product={product} currency={props.currency} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Markets
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  aria-label="Marketplace count unavailable"
                >
                  —
                </Typography>
              </Box>
              <Box sx={{ gridColumn: '1 / -1' }}>
                <Typography variant="caption" color="text.secondary">
                  Updated
                </Typography>
                <Typography variant="body2">
                  {new Date(product.updatedAt).toLocaleDateString()}
                </Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default ProductsTable;
