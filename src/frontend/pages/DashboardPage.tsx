// Workspace overview: KPI tiles, revenue trend, marketplace summary, quick
// actions, recent Hermes activity, and products needing attention.
import React from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import AnalyticsIcon from '@mui/icons-material/InsightsOutlined';
import { useNavigate } from 'react-router-dom';
import type { HermesEvent, Marketplace, Product } from '@shared/types';
import {
  useAnalyticsOverview,
  useHermesEvents,
  useMarketplaces,
  useProducts,
} from '../services/hooks/index.js';
import { useAppSelector } from '../state/hooks.js';
import { formatCurrency, formatNumber } from '../utils/formatters.js';
import { StatCard } from '../components/common/StatCard.js';
import { Card } from '../components/common/Card.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { LoadingSkeleton } from '../components/common/Skeleton.js';
import { RevenueChart } from '../components/charts/index.js';
import { HermesEventCard } from '../components/hermes/index.js';
import { ProductStatusBadge } from '../components/common/Badge.js';

function marketplaceStatus(marketplace: Marketplace): { label: string; color: 'success' | 'warning' | 'default' } {
  if (!marketplace.connected) return { label: 'Not connected', color: 'default' };
  if (marketplace.errorCount > 0) return { label: 'Needs attention', color: 'warning' };
  return { label: 'Connected', color: 'success' };
}

const quickActions = [
  { label: 'Add product', path: '/products?newProduct=1', icon: <AddIcon fontSize="small" /> },
  { label: 'Manage marketplaces', path: '/marketplaces', icon: <SyncIcon fontSize="small" /> },
  { label: 'Run Hermes', path: '/hermes', icon: <AutoAwesomeIcon fontSize="small" /> },
  { label: 'View analytics', path: '/analytics', icon: <AnalyticsIcon fontSize="small" /> },
];

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const currency = useAppSelector((s) => s.workspace.currency);

  const overview = useAnalyticsOverview();
  const pending = useHermesEvents({ status: ['pending_review'], limit: 1 });
  const recent = useHermesEvents({ limit: 4, sort: '-createdAt' });
  const attention = useProducts({ status: ['attention'], limit: 5 });
  const marketplaces = useMarketplaces();

  const ov = overview.data;
  const marketplaceRows = marketplaces.data ?? [];
  const connectedMarketplaces = marketplaceRows.filter((m) => m.connected).length;
  const totalCapacity = marketplaceRows.reduce((sum, m) => sum + (m.capacity ?? 0), 0);
  const totalMarketplaceErrors = marketplaceRows.reduce((sum, m) => sum + (m.errorCount ?? 0), 0);
  const pct = (cur?: number, prev?: number) =>
    typeof cur === 'number' && typeof prev === 'number' && prev !== 0
      ? ((cur - prev) / prev) * 100
      : undefined;
  const marketplaceError = marketplaces.error
    ? marketplaces.error instanceof Error
      ? marketplaces.error.message
      : 'Unable to load marketplaces.'
    : 'Unable to load marketplaces.';

  return (
    <Box>
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
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.6fr) minmax(320px, 0.9fr)' },
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

        <Card title="Marketplace overview" subtitle="Connected sales channels and sync health">
          {marketplaces.isLoading ? (
            <LoadingSkeleton lines={4} height={52} />
          ) : marketplaces.isError ? (
            <EmptyState
              title="Marketplaces failed to load"
              description={marketplaceError}
              action={
                <Button variant="outlined" size="small" onClick={() => marketplaces.refetch()}>
                  Retry
                </Button>
              }
              compact
            />
          ) : marketplaceRows.length === 0 ? (
            <EmptyState title="No marketplaces configured" compact />
          ) : (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`${connectedMarketplaces}/${marketplaceRows.length} connected`} color="primary" />
                <Chip label={`${formatNumber(totalCapacity)} listing capacity`} variant="outlined" />
                {totalMarketplaceErrors > 0 && (
                  <Chip label={`${totalMarketplaceErrors} sync errors`} color="warning" />
                )}
              </Stack>
              <Stack spacing={1}>
                {marketplaceRows.slice(0, 4).map((marketplace) => {
                  const status = marketplaceStatus(marketplace);
                  return (
                    <Stack
                      key={marketplace.id}
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      spacing={2}
                      sx={{
                        border: (t) => `1px solid ${t.palette.divider}`,
                        borderRadius: 2,
                        px: 1.5,
                        py: 1.25,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                          {marketplace.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {marketplace.syncMode} sync · {formatNumber(marketplace.capacity)} capacity
                        </Typography>
                      </Box>
                      <Chip size="small" label={status.label} color={status.color} />
                    </Stack>
                  );
                })}
              </Stack>
            </Stack>
          )}
        </Card>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(280px, 0.7fr)' },
          mt: 2.5,
        }}
      >
        <Card
          title="Hermes AI activity"
          subtitle="Recent autonomous work and suggestions"
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

        <Card title="Quick actions" subtitle="Most common operator shortcuts">
          <Stack spacing={1.25}>
            {quickActions.map((action) => (
              <Button
                key={action.label}
                variant="outlined"
                startIcon={action.icon}
                onClick={() => navigate(action.path)}
                sx={{ justifyContent: 'flex-start', textTransform: 'none', fontWeight: 700 }}
              >
                {action.label}
              </Button>
            ))}
          </Stack>
        </Card>
      </Box>

      <Box sx={{ mt: 2.5 }}>
        <Card
          title="Recent activities and needs attention"
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
