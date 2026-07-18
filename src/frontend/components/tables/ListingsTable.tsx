// Listings table: marketplace, status, price, engagement (views/watchers/messages).
// Presentational; the page supplies data and a marketplace-name resolver.
import React, { useReducer, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Skeleton,
  Stack,
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import type { Listing, Marketplace } from '@shared/types';
import type { ListingDelistOperation } from '../../state/api/dto.js';
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
  onDelistToDraft?: (listing: Listing, operationId: string) => Promise<ListingDelistOperation>;
  productHref?: (listing: Listing) => string;
  resolveMarketplaceName?: (marketplaceId: string) => string;
  resolveMarketplaceKey?: (marketplaceId: string) => Marketplace['key'] | undefined;
  currency?: string;
  emptyAction?: React.ReactNode;
  actionsDisabled?: boolean;
}

export function DelistConfirmationContent({
  listing,
  marketplaceName,
  isOlx,
}: {
  listing: Listing;
  marketplaceName: string;
  isOlx: boolean;
}) {
  return (
    <Stack spacing={2}>
      <Alert severity="error">This destructive action removes the remote advert.</Alert>
      <Typography><strong>Marketplace:</strong> {marketplaceName}</Typography>
      <Typography><strong>Product:</strong> {listing.productName || 'Untitled product'}</Typography>
      <Typography><strong>Listing:</strong> {listing.id}</Typography>
      <Typography><strong>External ID:</strong> {listing.marketplaceListingId}</Typography>
      {listing.externalUrl && (
        <Link href={listing.externalUrl} target="_blank" rel="noopener noreferrer">
          Open the current remote advert for reconciliation
        </Link>
      )}
      <Typography>
        Only this listing will return to draft. Product data and photos remain. The advert will not be republished automatically.
      </Typography>
      {isOlx && (
        <Alert severity="warning">
          OLX does not restore a consumed quota unit after removal. Publishing again may be unavailable or paid and must pass category and quota preview.
        </Alert>
      )}
    </Stack>
  );
}

export interface DelistDialogFailure {
  kind: 'authentication' | 'validation' | 'provider_rejection' | 'ambiguous' | 'dependency';
  message: string;
  manualReconciliationRequired: boolean;
}

export interface DelistDialogState {
  listing: Listing | null;
  operationId: string | null;
  failure: DelistDialogFailure | null;
}

export type DelistDialogEvent =
  | { type: 'open'; listing: Listing; operationId: string }
  | { type: 'failed'; failure: DelistDialogFailure }
  | { type: 'reconciled_live'; operationId: string }
  | { type: 'close' };

export const initialDelistDialogState: DelistDialogState = {
  listing: null,
  operationId: null,
  failure: null,
};

export function delistDialogReducer(
  state: DelistDialogState,
  event: DelistDialogEvent,
): DelistDialogState {
  switch (event.type) {
    case 'open':
      return { listing: event.listing, operationId: event.operationId, failure: null };
    case 'failed':
      return {
        ...state,
        operationId: event.failure.manualReconciliationRequired ? state.operationId : null,
        failure: event.failure,
      };
    case 'reconciled_live':
      return { ...state, operationId: event.operationId, failure: null };
    case 'close':
      return initialDelistDialogState;
  }
}

function failureFromOperation(operation: ListingDelistOperation): DelistDialogFailure {
  const result = operation.result;
  const manualReconciliationRequired = result?.manualReconciliationRequired === true;
  return {
    kind: result?.failureKind ?? (manualReconciliationRequired ? 'ambiguous' : 'dependency'),
    message: result?.message ?? 'The delist operation did not complete.',
    manualReconciliationRequired,
  };
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
  onDelistToDraft,
  productHref,
  resolveMarketplaceName,
  resolveMarketplaceKey,
  currency,
  emptyAction,
  actionsDisabled = false,
}) => {
  const [delistDialog, dispatchDelistDialog] = useReducer(
    delistDialogReducer,
    initialDelistDialogState,
  );
  const [delistBusy, setDelistBusy] = useState(false);
  const delistListing = delistDialog.listing;
  const delistOperationId = delistDialog.operationId;
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
                      {listing.views ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      {listing.watchers ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      {listing.messages ?? '—'}
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
                    {onDelistToDraft
                      && listing.status === 'live'
                      && Boolean(listing.marketplaceListingId)
                      && resolveMarketplaceKey?.(listing.marketplaceId) === 'olx'
                      && (
                      <Tooltip title="Снять с площадки и вернуть в черновики">
                        <IconButton
                          size="small"
                          color="error"
                          disabled={actionsDisabled || delistBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatchDelistDialog({
                              type: 'open',
                              listing,
                              operationId: crypto.randomUUID(),
                            });
                          }}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
      <Dialog
        open={Boolean(delistListing)}
        onClose={delistBusy ? undefined : () => dispatchDelistDialog({ type: 'close' })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Снять с площадки и вернуть в черновики?</DialogTitle>
        <DialogContent>
          {delistListing && (
            <DelistConfirmationContent
              listing={delistListing}
              marketplaceName={resolveMarketplaceName
                ? resolveMarketplaceName(delistListing.marketplaceId)
                : delistListing.marketplaceId}
              isOlx={resolveMarketplaceKey?.(delistListing.marketplaceId) === 'olx'}
            />
          )}
          {delistDialog.failure && (
            <Alert severity="error" sx={{ mt: 2 }}>
              <strong>{delistDialog.failure.kind.replace(/_/g, ' ')}:</strong>{' '}
              {delistDialog.failure.message}
              {delistDialog.failure.manualReconciliationRequired && delistOperationId && (
                <> The remote result is uncertain. The listing remains live locally. Operation ID: {delistOperationId}</>
              )}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={delistBusy} onClick={() => dispatchDelistDialog({ type: 'close' })}>Cancel</Button>
          {delistDialog.failure && (
            <Button
              disabled={delistBusy}
              onClick={() => dispatchDelistDialog({
                type: 'reconciled_live',
                operationId: crypto.randomUUID(),
              })}
            >
              I confirmed the advert is still live — start a new operation
            </Button>
          )}
          <Button
            color="error"
            variant="contained"
            disabled={delistBusy || !delistListing || !delistOperationId || Boolean(delistDialog.failure)}
            onClick={async () => {
              if (!delistListing || !delistOperationId || !onDelistToDraft) return;
              setDelistBusy(true);
              try {
                const operation = await onDelistToDraft(delistListing, delistOperationId);
                if (operation.state === 'executed') {
                  dispatchDelistDialog({ type: 'close' });
                } else if (operation.state === 'failed') {
                  dispatchDelistDialog({ type: 'failed', failure: failureFromOperation(operation) });
                } else {
                  dispatchDelistDialog({
                    type: 'failed',
                    failure: {
                      kind: 'ambiguous',
                      message: `The operation remains ${operation.state} and must be reconciled before another attempt.`,
                      manualReconciliationRequired: true,
                    },
                  });
                }
              } catch {
                dispatchDelistDialog({
                  type: 'failed',
                  failure: {
                    kind: 'ambiguous',
                    message: 'The API response was lost before the remote result could be confirmed.',
                    manualReconciliationRequired: true,
                  },
                });
              } finally {
                setDelistBusy(false);
              }
            }}
          >
            Снять с площадки
          </Button>
        </DialogActions>
      </Dialog>
    </TableContainer>
  );
};

export default ListingsTable;
