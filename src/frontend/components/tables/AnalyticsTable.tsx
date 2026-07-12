// Per-listing analytics breakdown table (views, watchers, messages, revenue, profit).
import React from 'react';
import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { ListingPerformance } from '../../state/api/index.js';
import { formatCurrency, formatNumber } from '../../utils/formatters.js';
import { ListingStatusBadge } from '../common/Badge.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { EmptyState } from '../common/EmptyState.js';

export interface AnalyticsTableProps {
  metrics?: ListingPerformance[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  currency?: string;
}

const HEAD = ['Listing', 'Status', 'Price', 'Views', 'Watchers', 'Messages'];

export const AnalyticsTable: React.FC<AnalyticsTableProps> = ({
  metrics,
  loading = false,
  error,
  onRetry,
  currency,
}) => {
  if (error) return <ErrorRetry error={error} onRetry={onRetry} />;

  if (!loading && (!metrics || metrics.length === 0)) {
    return (
      <EmptyState
        title="No analytics yet"
        description="Metrics appear here once your listings start collecting views and sales."
        compact
      />
    );
  }

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            {HEAD.map((label, i) => (
              <TableCell key={label} align={i >= 2 ? 'right' : 'left'} sx={{ fontWeight: 700 }}>
                {label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`s-${i}`}>
                  {HEAD.map((label, j) => (
                    <TableCell key={j} align={j >= 2 ? 'right' : 'left'}>
                      <Skeleton variant="text" width={j === 0 ? 140 : 60} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : (metrics ?? []).map((m) => (
                <TableRow key={m.listingId} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {m.productId}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <ListingStatusBadge status={m.status} />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatCurrency(m.price, currency)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{formatNumber(m.views)}</TableCell>
                  <TableCell align="right">{formatNumber(m.watchers)}</TableCell>
                  <TableCell align="right">{formatNumber(m.messages)}</TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default AnalyticsTable;
