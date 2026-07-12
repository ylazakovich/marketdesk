// Workspace overview: KPI tiles, revenue trend, recent Hermes activity, and
// products needing attention. All data via RTK Query hooks (Group 8).
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import { useNavigate } from 'react-router-dom';
import type { HermesEvent, Product } from '@shared/types';
import {
  useAnalyticsOverview,
  useHermesEvents,
  useProducts,
} from '../services/hooks/index.js';
import { useAppSelector } from '../state/hooks.js';
import { formatCurrency, formatNumber } from '../utils/formatters.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { StatCard } from '../components/common/StatCard.js';
import { Card } from '../components/common/Card.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { LoadingSkeleton } from '../components/common/Skeleton.js';
import { RevenueChart } from '../components/charts/index.js';
import { HermesEventCard } from '../components/hermes/index.js';
import { ProductStatusBadge } from '../components/common/Badge.js';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const currency = useAppSelector((s) => s.workspace.currency);

  const overview = useAnalyticsOverview();
  const pending = useHermesEvents({ status: ['pending_review'], limit: 1 });
  const recent = useHermesEvents({ limit: 4, sort: '-createdAt' });
  const attention = useProducts({ status: ['attention'], limit: 5 });

  const ov = overview.data;
  const pct = (cur?: number, prev?: number) =>
    typeof cur === 'number' && typeof prev === 'number' && prev !== 0
      ? ((cur - prev) / prev) * 100
      : undefined;

  return (
    <Box>
      <PageHeader title="Dashboard" subtitle="Welcome back — here's what moved today." />

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
          label="Pending Hermes"
          value={formatNumber(pending.data?.total ?? 0)}
          icon={<AutoAwesomeIcon fontSize="small" />}
          loading={pending.isLoading}
        />
        <StatCard
          label="Total views"
          value={formatNumber(ov?.totalViews)}
          deltaPct={pct(ov?.totalViews, ov?.previous?.totalViews)}
          icon={<VisibilityIcon fontSize="small" />}
          loading={overview.isLoading}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
          alignItems: 'stretch',
        }}
      >
        <Card
          title="Sales overview"
          subtitle="Revenue and profit"
          action={
            <Button size="small" onClick={() => navigate('/analytics')}>
              View analytics
            </Button>
          }
        >
          <RevenueChart height={300} />
        </Card>

        <Card
          title="Hermes activity"
          action={
            <Button size="small" onClick={() => navigate('/hermes')}>
              Open Hermes
            </Button>
          }
          contentSx={{ p: 2 }}
        >
          {recent.isLoading ? (
            <LoadingSkeleton lines={4} height={64} />
          ) : (recent.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No recent activity" compact />
          ) : (
            <Stack spacing={1.5}>
              {recent.data?.items.map((event: HermesEvent) => (
                <HermesEventCard key={event.id} event={event} showActions={false} />
              ))}
            </Stack>
          )}
        </Card>
      </Box>

      <Box sx={{ mt: 2.5 }}>
        <Card
          title="Needs attention"
          subtitle="Products flagged for review"
          action={
            <Button size="small" onClick={() => navigate('/products')}>
              All products
            </Button>
          }
        >
          {attention.isLoading ? (
            <LoadingSkeleton lines={3} height={48} />
          ) : (attention.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="Nothing needs attention" compact />
          ) : (
            <Stack divider={<Box sx={{ borderBottom: (t) => `1px solid ${t.palette.divider}` }} />}>
              {attention.data?.items.map((product: Product) => (
                <Stack
                  key={product.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={2}
                  sx={{ py: 1.25, cursor: 'pointer' }}
                  onClick={() => navigate(`/products/${product.id}`)}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {product.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {product.sku}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatCurrency(product.sellingPrice, currency)}
                    </Typography>
                    <ProductStatusBadge status={product.status} />
                  </Stack>
                </Stack>
              ))}
            </Stack>
          )}
        </Card>
      </Box>
    </Box>
  );
};

export default DashboardPage;
