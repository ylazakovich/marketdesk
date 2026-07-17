// Sortable products table with status badges, pricing, and row actions.
// Presentational: data + sort state are owned by the page (driven by RTK Query).
import React from 'react';
import {
  Box,
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
import type { Product } from '@shared/types';
import { formatCurrency } from '../../utils/formatters.js';
import { conditionLabel } from '../../utils/labels.js';
import { ProductStatusBadge } from '../common/Badge.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { EmptyState } from '../common/EmptyState.js';

type SortDir = 'asc' | 'desc';

interface ColumnDef {
  id: keyof Product | string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right';
}

const COLUMNS: ColumnDef[] = [
  { id: 'name', label: 'Product', sortable: true },
  { id: 'status', label: 'Status', sortable: true },
  { id: 'condition', label: 'Condition' },
  { id: 'category', label: 'Category' },
  { id: 'costPrice', label: 'Cost', sortable: true, align: 'right' },
  { id: 'sellingPrice', label: 'Price', sortable: true, align: 'right' },
  { id: 'updatedAt', label: 'Updated', sortable: true, align: 'right' },
];

export interface ProductsTableProps {
  products?: Product[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (product: Product) => void;
  onEdit?: (product: Product) => void;
  sort?: string; // e.g. "-updatedAt"
  onSortChange?: (sort: string) => void;
  currency?: string;
  emptyAction?: React.ReactNode;
}

function parseSort(sort?: string): { field: string; dir: SortDir } | null {
  if (!sort) return null;
  const first = sort.split(',')[0]?.trim();
  if (!first) return null;
  if (first.startsWith('-')) return { field: first.slice(1), dir: 'desc' };
  if (first.startsWith('+')) return { field: first.slice(1), dir: 'asc' };
  return { field: first, dir: 'asc' };
}

export const ProductsTable: React.FC<ProductsTableProps> = ({
  products,
  loading = false,
  error,
  onRetry,
  onRowClick,
  onEdit,
  sort,
  onSortChange,
  currency,
  emptyAction,
}) => {
  const active = parseSort(sort);

  const handleSort = (field: string) => {
    if (!onSortChange) return;
    const nextDir: SortDir = active?.field === field && active.dir === 'asc' ? 'desc' : 'asc';
    onSortChange(`${nextDir === 'desc' ? '-' : ''}${field}`);
  };

  if (error) return <ErrorRetry error={error} onRetry={onRetry} />;

  if (!loading && (!products || products.length === 0)) {
    return (
      <EmptyState
        title="No products yet"
        description="Create your first product to start listing across marketplaces."
        action={emptyAction}
      />
    );
  }

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="medium" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            {COLUMNS.map((col) => (
              <TableCell key={col.id} align={col.align ?? 'left'} sx={{ fontWeight: 700 }}>
                {col.sortable && onSortChange ? (
                  <TableSortLabel
                    active={active?.field === col.id}
                    direction={active?.field === col.id ? active.dir : 'asc'}
                    onClick={() => handleSort(String(col.id))}
                  >
                    {col.label}
                  </TableSortLabel>
                ) : (
                  col.label
                )}
              </TableCell>
            ))}
            <TableCell align="right" sx={{ fontWeight: 700 }}>
              Actions
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`s-${i}`}>
                  {COLUMNS.map((col) => (
                    <TableCell key={col.id} align={col.align ?? 'left'}>
                      <Skeleton variant="text" width={col.id === 'name' ? 180 : 80} />
                    </TableCell>
                  ))}
                  <TableCell align="right">
                    <Skeleton variant="circular" width={28} height={28} sx={{ ml: 'auto' }} />
                  </TableCell>
                </TableRow>
              ))
            : (products ?? []).map((product) => (
                <TableRow
                  key={product.id}
                  hover
                  onClick={onRowClick ? () => onRowClick(product) : undefined}
                  sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
                >
                  <TableCell>
                    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {product.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {product.sku}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <ProductStatusBadge status={product.status} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{conditionLabel(product.condition)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.25} sx={{ maxWidth: 280 }}>
                      <Typography variant="body2" color="text.secondary">
                        {product.category || '—'}
                      </Typography>
                      {product.categoryProvenance?.status === 'synced' && (
                        <Tooltip
                          title={product.categoryProvenance.sources
                            .map((source) => [
                              `${source.path.join(' › ')} (${source.providerCategoryId})`,
                              `listing ${source.listingId}`,
                              `taxonomy verified ${source.taxonomyVerifiedAt}`,
                              `synced ${source.syncedAt}`,
                            ].join(' · '))
                            .join('\n')}
                        >
                          <Typography variant="caption" color="success.main" noWrap>
                            Source: {product.categoryProvenance.sources
                              .map((source) => source.marketplaceKey.toUpperCase())
                              .filter((key, index, keys) => keys.indexOf(key) === index)
                              .join(', ')} · {product.categoryProvenance.sources[0]?.path.join(' › ')}
                          </Typography>
                        </Tooltip>
                      )}
                      {product.categoryProvenance?.status === 'conflict' && (
                        <Typography variant="caption" color="warning.main" sx={{ fontWeight: 600 }}>
                          Category conflict · review required
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      {formatCurrency(product.costPrice, currency)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatCurrency(product.sellingPrice, currency)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      {new Date(product.updatedAt).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {onEdit && (
                      <Tooltip title="Edit product">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(product);
                          }}
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
      {loading && <Box sx={{ height: 4 }} />}
    </TableContainer>
  );
};

export default ProductsTable;
