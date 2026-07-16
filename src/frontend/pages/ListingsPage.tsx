// Cross-marketplace listings overview with status filtering. Rows link through
// to the owning product's detail page.
import React, { useMemo, useState } from 'react';
import { Box, MenuItem, Select, Stack } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { Listing, ListingStatus } from '@shared/types';
import { LISTING_STATUS_LIST } from '@shared/constants';
import { useListings } from '../services/hooks/index.js';
import type { ListingListParams } from '../state/api/index.js';
import { useMarketplaceLookup } from '../hooks/useMarketplaceLookup.js';
import { useAppSelector } from '../state/hooks.js';
import { Card } from '../components/common/Card.js';
import { ListingStatusBadge } from '../components/common/Badge.js';
import { ListingsTable } from '../components/tables/index.js';

const ListingsPage: React.FC = () => {
  const navigate = useNavigate();
  const currency = useAppSelector((s) => s.workspace.currency);
  const { resolveMarketplaceName } = useMarketplaceLookup();

  const [statusFilter, setStatusFilter] = useState<ListingStatus[]>([]);

  const params = useMemo<ListingListParams>(() => {
    const p: ListingListParams = { sort: '-updatedAt', limit: 100 };
    if (statusFilter.length) p.status = statusFilter;
    return p;
  }, [statusFilter]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListings(params);


  const handleStatusChange = (e: SelectChangeEvent<ListingStatus[]>) => {
    const value = e.target.value;
    setStatusFilter(typeof value === 'string' ? (value.split(',') as ListingStatus[]) : value);
  };

  const handleRelist = (listing: Listing) => {
    navigate(`/products/${listing.productId}`, {
      state: { publicationReview: { listingId: listing.id, mode: 'relist' } },
    });
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2.5 }}>
        <Select
          size="small"
          multiple
          displayEmpty
          inputProps={{ 'aria-label': 'Listing status filter' }}
          value={statusFilter}
          onChange={handleStatusChange}
          renderValue={(selected) =>
            selected.length === 0 ? (
              'All statuses'
            ) : (
              <Stack direction="row" spacing={0.5} flexWrap="wrap">
                {selected.map((s) => (
                  <ListingStatusBadge key={s} status={s} />
                ))}
              </Stack>
            )
          }
          sx={{ minWidth: 200 }}
        >
          {LISTING_STATUS_LIST.map((s) => (
            <MenuItem key={s} value={s}>
              <ListingStatusBadge status={s} />
            </MenuItem>
          ))}
        </Select>
      </Stack>

      <Card disablePadding>
        <ListingsTable
          listings={data}
          loading={isLoading || isFetching}
          error={isError ? error : undefined}
          onRetry={refetch}
          currency={currency}
          resolveMarketplaceName={resolveMarketplaceName}
          productHref={(l) => `/products/${l.productId}`}
          onRowClick={(l) => navigate(`/products/${l.productId}`)}
          onRelist={handleRelist}
        />
      </Card>
    </Box>
  );
};

export default ListingsPage;
