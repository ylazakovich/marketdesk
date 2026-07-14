// Analytics: date-range-scoped KPIs, revenue/views/conversion charts, and a
// per-listing metrics table. All series come from the analytics hooks.
import React, { useMemo, useState } from 'react';
import { Box, Stack, TextField, Typography } from '@mui/material';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import { useAnalyticsListings, useAnalyticsOverview } from '../services/hooks/index.js';
import type { AnalyticsQueryParams } from '../state/api/index.js';
import { useAppSelector } from '../state/hooks.js';
import { formatCurrency, formatNumber } from '../utils/formatters.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { Card } from '../components/common/Card.js';
import { StatCard } from '../components/common/StatCard.js';
import { RevenueChart, ViewsChart, ConversionChart } from '../components/charts/index.js';
import { AnalyticsTable } from '../components/tables/index.js';

export interface AnalyticsDateRangeControlsProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

export const AnalyticsDateRangeControls: React.FC<AnalyticsDateRangeControlsProps> = ({
  from,
  to,
  onFromChange,
  onToChange,
}) => (
  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="stretch">
    <Stack spacing={0.5} sx={{ minWidth: 160 }}>
      <Typography component="label" variant="caption" color="text.secondary" htmlFor="analytics-from">
        From
      </Typography>
      <TextField
        id="analytics-from"
        size="small"
        type="date"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        inputProps={{ 'aria-label': 'From date' }}
      />
    </Stack>
    <Stack spacing={0.5} sx={{ minWidth: 160 }}>
      <Typography component="label" variant="caption" color="text.secondary" htmlFor="analytics-to">
        To
      </Typography>
      <TextField
        id="analytics-to"
        size="small"
        type="date"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        inputProps={{ 'aria-label': 'To date' }}
      />
    </Stack>
  </Stack>
);

const AnalyticsPage: React.FC = () => {
  const currency = useAppSelector((s) => s.workspace.currency);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = useMemo<AnalyticsQueryParams>(() => {
    const p: AnalyticsQueryParams = {};
    if (from) p.from = from;
    if (to) p.to = to;
    return p;
  }, [from, to]);

  const overview = useAnalyticsOverview(params);
  const listings = useAnalyticsListings(params);
  const ov = overview.data;
  const pct = (cur?: number, prev?: number) =>
    typeof cur === 'number' && typeof prev === 'number' && prev !== 0
      ? ((cur - prev) / prev) * 100
      : undefined;

  return (
    <Box>
      <PageHeader
        title="Analytics"
        subtitle="Performance across marketplaces."
        actions={
          <AnalyticsDateRangeControls
            from={from}
            to={to}
            onFromChange={setFrom}
            onToChange={setTo}
          />
        }
      />

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
          mb: 2.5,
        }}
      >
        <StatCard
          label="Inventory value"
          value={formatCurrency(ov?.inventoryValue, currency)}
          deltaPct={pct(ov?.inventoryValue, ov?.previous?.inventoryValue)}
          icon={<PaidIcon fontSize="small" />}
          loading={overview.isLoading}
        />
        <StatCard
          label="Live listings"
          value={formatNumber(ov?.liveListingCount)}
          deltaPct={pct(ov?.liveListingCount, ov?.previous?.liveListingCount)}
          icon={<StorefrontIcon fontSize="small" />}
          loading={overview.isLoading}
        />
        <StatCard
          label="Total views"
          value={formatNumber(ov?.totalViews)}
          deltaPct={pct(ov?.totalViews, ov?.previous?.totalViews)}
          icon={<VisibilityIcon fontSize="small" />}
          loading={overview.isLoading}
        />
        <StatCard
          label="Messages"
          value={formatNumber(ov?.totalMessages)}
          deltaPct={pct(ov?.totalMessages, ov?.previous?.totalMessages)}
          icon={<ChatBubbleOutlineIcon fontSize="small" />}
          loading={overview.isLoading}
        />
      </Box>

      <Card title="Revenue" subtitle="Over the selected period" sx={{ mb: 2.5 }}>
        <RevenueChart params={params} height={320} />
      </Card>

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          mb: 2.5,
        }}
      >
        <Card title="Top listings by views">
          <ViewsChart params={params} />
        </Card>
        <Card title="Engagement funnel">
          <ConversionChart params={params} />
        </Card>
      </Box>

      <Card title="Listing performance" disablePadding>
        <AnalyticsTable
          metrics={listings.data}
          loading={listings.isLoading}
          error={listings.isError ? listings.error : undefined}
          onRetry={listings.refetch}
          currency={currency}
        />
      </Card>
    </Box>
  );
};

export default AnalyticsPage;
