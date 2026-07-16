// Listings table: marketplace, status, price, engagement (views/watchers/messages).
// Presentational; the page supplies data and a marketplace-name resolver.
import React from 'react';
import {
  IconButton,
  Link,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import PublishIcon from '@mui/icons-material/Publish';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { Listing } from '@shared/types';
import { formatCurrency } from '../../utils/formatters.js';
import { ListingStatusBadge } from '../common/Badge.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { EmptyState } from '../common/EmptyState.js';

export interface ListingsTableProps {
  listings?: Listing[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (listing: Listing) => void;
  onRelist?: (listing: Listing) => void;
  onPublish?: (listing: Listing) => void;
  productHref?: (listing: Listing) => string;
  resolveMarketplaceName?: (marketplaceId: string) => string;
  currency?: string;
  emptyAction?: React.ReactNode;
  actionsDisabled?: boolean;
}

const HEAD_CELLS = ['Listing', 'Status', 'Price', 'Views', 'Watchers', 'Messages', ''];

export const ListingsTable: React.FC<ListingsTableProps> = ({
  listings,
  loading = false,
  error,
  onRetry,
  onRowClick,
  onRelist,
  onPublish,
  productHref,
  resolveMarketplaceName,
  currency,
  emptyAction,
  actionsDisabled = false,
}) => {
  if (error) return <ErrorRetry error={error} onRetry={onRetry} />;

  if (!loading && (!listings || listings.length === 0)) {
    return (
      <EmptyState
        title="No listings"
        description="Publish this product to a marketplace to create its first listing."
        action={emptyAction}
      />
    );
  }

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="medium" sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            {HEAD_CELLS.map((label, i) => (
              <TableCell
                key={label || `c-${i}`}
                align={i >= 2 && i <= 5 ? 'right' : 'left'}
                sx={{ fontWeight: 700 }}
              >
                {label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`s-${i}`}>
                  {HEAD_CELLS.map((label, j) => (
                    <TableCell key={j} align={j >= 2 && j <= 5 ? 'right' : 'left'}>
                      <Skeleton variant="text" width={j === 0 ? 140 : 60} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : (listings ?? []).map((listing) => (
                <TableRow
                  key={listing.id}
                  hover
                  onClick={onRowClick ? () => onRowClick(listing) : undefined}
                  sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
                >
                  <TableCell>
                    {productHref ? (
                      <Link
                        href={productHref(listing)}
                        underline="hover"
                        variant="body2"
                        onClick={(event) => event.stopPropagation()}
                        sx={{ fontWeight: 600 }}
                      >
                        {listing.productName?.trim() || 'Untitled product'}
                      </Link>
                    ) : (
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {listing.productName?.trim() || 'Untitled product'}
                      </Typography>
                    )}
                    {listing.productSku && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        SKU {listing.productSku}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {resolveMarketplaceName
                        ? resolveMarketplaceName(listing.marketplaceId)
                        : listing.marketplaceId}
                    </Typography>
                    {listing.syncError && (
                      <Typography variant="caption" color="error.main" noWrap>
                        {listing.syncError}
                      </Typography>
                    )}
                    {listing.externalUrl && listing.status === 'live' && (
                      <Link
                        href={listing.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        underline="hover"
                        variant="caption"
                        onClick={(event) => event.stopPropagation()}
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
                      >
                        View on OLX
                        <OpenInNewIcon sx={{ fontSize: 14 }} />
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>
                    <ListingStatusBadge status={listing.status} />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatCurrency(listing.price, currency)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      {listing.views}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      {listing.watchers}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      {listing.messages}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {onPublish && listing.status === 'draft' && (
                      <Tooltip title="Publish">
                        <IconButton
                          size="small"
                          disabled={actionsDisabled}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPublish(listing);
                          }}
                        >
                          <PublishIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {onRelist && (listing.status === 'expired' || listing.status === 'error') && (
                      <Tooltip title="Relist">
                        <IconButton
                          size="small"
                          disabled={actionsDisabled}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRelist(listing);
                          }}
                        >
                          <ReplayIcon fontSize="small" />
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

export default ListingsTable;
