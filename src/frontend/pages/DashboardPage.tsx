// Daily command center built from real workspace analytics, marketplace, product,
// and Hermes contracts. The global shell owns the page h1, search, and creation CTA.
import React from 'react';
import { Alert, Box, Button, ButtonBase, Chip, Stack, Typography } from '@mui/material';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import WarningAmberIcon from '@mui/icons-material/WarningAmberOutlined';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import AnalyticsIcon from '@mui/icons-material/InsightsOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import { useNavigate } from 'react-router-dom';
import type { HermesEvent, Marketplace, Product } from '@shared/types';
import {
  useAnalyticsOverview,
  useHermesEvents,
  useMarketplaces,
  useProducts,
} from '../services/hooks/index.js';
import { useAppSelector } from '../state/hooks.js';
import { formatCurrency, formatNumber, formatRelativeTime } from '../utils/formatters.js';
import { hermesTypeLabel } from '../utils/labels.js';
import { StatCard } from '../components/common/StatCard.js';
import { Card } from '../components/common/Card.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { LoadingSkeleton } from '../components/common/Skeleton.js';
import { RevenueChart } from '../components/charts/index.js';
import { SeoReviewSummary } from '../components/hermes/index.js';
import {
  HermesSeverityBadge,
  HermesStatusBadge,
  ProductStatusBadge,
} from '../components/common/Badge.js';
import {
  DASHBOARD_EVENT_LIMIT,
  DASHBOARD_QUICK_ACTIONS,
  dashboardRevenueRange,
  marketplaceOperationalSummary,
  marketplacePresentation,
  shouldShowHermesRunning,
  splitDashboardEvents,
} from './dashboardPresentation.js';

const MARKETPLACE_COLORS: Partial<Record<Marketplace['key'], string>> = {
  olx: '#12B6AB',
  allegro: '#FF5A00',
  vinted: '#09B1BA',
  facebook: '#1877F2',
  ebay: '#E53238',
  etsy: '#F56400',
  amazon: '#FF9900',
};

const QUICK_ACTION_ICONS = {
  add: <AddIcon fontSize="small" />,
  channels: <SyncIcon fontSize="small" />,
  hermes: <AutoAwesomeIcon fontSize="small" />,
  analytics: <AnalyticsIcon fontSize="small" />,
} satisfies Record<(typeof DASHBOARD_QUICK_ACTIONS)[number]['key'], React.ReactNode>;

function queryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: { message?: string } } }).data;
    if (data?.error?.message) return data.error.message;
  }
  return fallback;
}

const InlineQueryError: React.FC<{
  title: string;
  error: unknown;
  onRetry: () => void;
}> = ({ title, error, onRetry }) => (
  <Alert
    severity="error"
    action={
      <Button color="inherit" size="small" onClick={onRetry}>
        Retry
      </Button>
    }
    sx={{ alignItems: 'center' }}
  >
    <Typography variant="subtitle2" component="div">
      {title}
    </Typography>
    <Typography variant="caption" component="div">
      {queryErrorMessage(error, 'This dashboard block is temporarily unavailable.')}
    </Typography>
  </Alert>
);

const MarketplaceRow: React.FC<{ marketplace: Marketplace; onOpen: () => void }> = ({
  marketplace,
  onOpen,
}) => {
  const status = marketplacePresentation(marketplace);
  const logoColor = MARKETPLACE_COLORS[marketplace.key] ?? 'text.secondary';
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={`Open ${marketplace.name} marketplace`}
      sx={{
        width: '100%',
        border: (theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: 2.5,
        px: 1.5,
        py: 1.25,
        textAlign: 'left',
        alignItems: 'stretch',
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: 2,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            bgcolor: logoColor,
            color: 'common.white',
            fontSize: 11,
            fontWeight: 900,
          }}
        >
          {marketplace.name.slice(0, 3).toUpperCase()}
        </Box>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
            <Typography variant="body2" noWrap sx={{ fontWeight: 800 }}>
              {marketplace.name}
            </Typography>
            <Chip size="small" label={status.statusLabel} color={status.statusColor} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            {marketplaceOperationalSummary(marketplace)}
          </Typography>
        </Box>
      </Stack>
    </ButtonBase>
  );
};

const HermesEventRow: React.FC<{
  event: HermesEvent;
  onOpen: () => void;
  compact?: boolean;
}> = ({ event, onOpen, compact = false }) => (
  <ButtonBase
    onClick={onOpen}
    aria-label={`Open Hermes event: ${event.title}`}
    sx={{
      width: '100%',
      textAlign: 'left',
      py: compact ? 1 : 1.25,
      borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
      '&:last-of-type': { borderBottom: 0 },
    }}
  >
    <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ width: '100%' }}>
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: 2,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          color: 'primary.contrastText',
          background: (theme) =>
            `linear-gradient(135deg, ${theme.palette.primary.light}, ${theme.palette.primary.dark})`,
        }}
      >
        <AutoAwesomeIcon fontSize="small" />
      </Box>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            {event.title}
          </Typography>
          <HermesSeverityBadge severity={event.severity} />
          {!compact && <HermesStatusBadge status={event.status} />}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {hermesTypeLabel(event.type)}
          {event.detail ? ` · ${event.detail}` : ''}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        {formatRelativeTime(event.createdAt)}
      </Typography>
    </Stack>
  </ButtonBase>
);

const AttentionRow: React.FC<{ product: Product; onOpen: () => void }> = ({ product, onOpen }) => (
  <ButtonBase
    onClick={onOpen}
    aria-label={`Open product requiring attention: ${product.name}`}
    sx={{ width: '100%', textAlign: 'left', py: 1 }}
  >
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ width: '100%' }}>
      <Box
        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }}
      />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 800 }}>
          {product.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {product.sku} · Product requires review
        </Typography>
      </Box>
      <ProductStatusBadge status={product.status} />
      <ChevronRightIcon color="disabled" fontSize="small" />
    </Stack>
  </ButtonBase>
);

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const currency = useAppSelector((state) => state.workspace.currency);
  const overview = useAnalyticsOverview();
  const pending = useHermesEvents({ status: ['pending_review'], limit: 1, sort: '-createdAt' });
  const recent = useHermesEvents({ limit: DASHBOARD_EVENT_LIMIT, sort: '-createdAt' });
  const activeHermes = useHermesEvents({ status: ['applying', 'reverting'], limit: 1 });
  const attention = useProducts({ status: ['attention'], limit: 5 });
  const marketplaces = useMarketplaces();
  const revenueRange = React.useMemo(() => dashboardRevenueRange(), []);

  const ov = overview.data;
  const marketplaceRows = marketplaces.data ?? [];
  const recentEvents = recent.data?.items ?? [];
  const eventSections = splitDashboardEvents(recentEvents);
  const hermesActive = shouldShowHermesRunning(activeHermes.data?.items ?? [], {
    isLoading: activeHermes.isLoading,
    isError: activeHermes.isError,
  });
  const pct = (current?: number, previous?: number) =>
    typeof current === 'number' && typeof previous === 'number' && previous !== 0
      ? ((current - previous) / previous) * 100
      : undefined;

  const kpiErrors = [overview.isError, pending.isError, attention.isError].some(Boolean);
  const retryKpis = () => {
    if (overview.isError) overview.refetch();
    if (pending.isError) pending.refetch();
    if (attention.isError) attention.refetch();
  };

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
      <Box
        aria-label="Workspace key performance indicators"
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(4, minmax(0, 1fr))',
          },
        }}
      >
        <StatCard
          label="Inventory value"
          value={overview.isError ? '—' : formatCurrency(ov?.inventoryValue, currency)}
          deltaPct={
            overview.isError ? undefined : pct(ov?.inventoryValue, ov?.previous?.inventoryValue)
          }
          icon={<PaidIcon fontSize="small" />}
          loading={overview.isLoading}
        />
        <StatCard
          label="Live listings"
          value={overview.isError ? '—' : formatNumber(ov?.liveListingCount)}
          deltaPct={
            overview.isError ? undefined : pct(ov?.liveListingCount, ov?.previous?.liveListingCount)
          }
          icon={<StorefrontIcon fontSize="small" />}
          loading={overview.isLoading}
        />
        <StatCard
          label="Pending Hermes"
          value={pending.isError ? '—' : formatNumber(pending.data?.total ?? 0)}
          icon={<AutoAwesomeIcon fontSize="small" />}
          loading={pending.isLoading}
        />
        <StatCard
          label="Needs attention"
          value={attention.isError ? '—' : formatNumber(attention.data?.total ?? 0)}
          icon={<WarningAmberIcon fontSize="small" />}
          loading={attention.isLoading}
        />
      </Box>
      {kpiErrors && (
        <Alert
          severity="error"
          icon={<ErrorOutlineIcon />}
          action={
            <Button color="inherit" size="small" onClick={retryKpis}>
              Retry failed metrics
            </Button>
          }
          sx={{ mt: 1.5 }}
        >
          Some dashboard metrics could not be loaded. Unknown values are shown as —.
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.62fr) minmax(320px, 1fr)' },
          mt: 2.5,
        }}
      >
        <Card
          title="Sales overview"
          subtitle="Revenue · last 30 days"
          action={
            <Button size="small" onClick={() => navigate('/analytics')}>
              View analytics
            </Button>
          }
        >
          <RevenueChart params={revenueRange} height={280} />
        </Card>
        <Card
          title="Marketplace overview"
          subtitle="Connection state and synchronization health"
          action={
            <Button size="small" onClick={() => navigate('/marketplaces')}>
              Manage
            </Button>
          }
        >
          {marketplaces.isLoading ? (
            <LoadingSkeleton lines={4} height={58} />
          ) : marketplaces.isError ? (
            <InlineQueryError
              title="Marketplaces failed to load"
              error={marketplaces.error}
              onRetry={() => marketplaces.refetch()}
            />
          ) : marketplaceRows.length === 0 ? (
            <EmptyState
              title="No marketplaces configured"
              description="Connect OLX to begin synchronizing listings."
              action={
                <Button variant="outlined" onClick={() => navigate('/marketplaces')}>
                  Open marketplaces
                </Button>
              }
              compact
            />
          ) : (
            <Stack spacing={1.25}>
              {marketplaceRows.slice(0, 4).map((marketplace) => (
                <MarketplaceRow
                  key={marketplace.id}
                  marketplace={marketplace}
                  onOpen={() => navigate('/marketplaces')}
                />
              ))}
            </Stack>
          )}
        </Card>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 2fr) minmax(300px, 1fr)' },
          mt: 2.5,
          alignItems: 'start',
        }}
      >
        <Card
          title={
            <Stack direction="row" spacing={1} alignItems="center">
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: 2,
                  display: 'grid',
                  placeItems: 'center',
                  color: 'common.white',
                  background: (theme) =>
                    `linear-gradient(135deg, ${theme.palette.primary.light}, ${theme.palette.secondary.main})`,
                }}
              >
                <AutoAwesomeIcon sx={{ fontSize: 17 }} />
              </Box>
              <span>Hermes AI activity</span>
              {hermesActive && <Chip size="small" color="success" label="Running" />}
            </Stack>
          }
          subtitle="Latest autonomous work and reviewable suggestions"
          action={
            <Button size="small" onClick={() => navigate('/hermes')}>
              View all
            </Button>
          }
          contentSx={{ pt: 1 }}
        >
          {recent.isLoading ? (
            <LoadingSkeleton lines={4} height={64} />
          ) : recent.isError ? (
            <InlineQueryError
              title="Hermes activity failed to load"
              error={recent.error}
              onRetry={() => recent.refetch()}
            />
          ) : eventSections.latest.length === 0 ? (
            <EmptyState
              title="No Hermes activity yet"
              description="Connect a marketplace, then run Hermes to start monitoring."
              action={
                <Button variant="outlined" onClick={() => navigate('/marketplaces')}>
                  Connect marketplace
                </Button>
              }
              compact
            />
          ) : (
            <Stack>
              {eventSections.latest.map((event) => (
                <HermesEventRow key={event.id} event={event} onOpen={() => navigate('/hermes')} />
              ))}
            </Stack>
          )}
        </Card>

        <Stack spacing={2.5}>
          <SeoReviewSummary
            event={pending.data?.items[0]}
            total={pending.data?.total ?? 0}
            loading={pending.isLoading}
            error={pending.isError ? pending.error : undefined}
            onRetry={() => pending.refetch()}
            onReview={(event) =>
              navigate(event.productId ? `/products/${encodeURIComponent(event.productId)}` : '/hermes')
            }
            onViewAll={() => navigate('/hermes')}
          />
          <Card title="Quick actions" subtitle="Common operator shortcuts">
            <Box
              sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}
            >
              {DASHBOARD_QUICK_ACTIONS.map((action) => (
                <ButtonBase
                  key={action.label}
                  onClick={() => navigate(action.path)}
                  aria-label={action.label}
                  sx={{
                    minHeight: 104,
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2.5,
                    p: 1.5,
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    flexDirection: 'column',
                    textAlign: 'left',
                    '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
                  }}
                >
                  <Box
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: 2,
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'action.selected',
                      color: 'primary.main',
                    }}
                  >
                    {QUICK_ACTION_ICONS[action.key]}
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    {action.label}
                  </Typography>
                </ButtonBase>
              ))}
            </Box>
          </Card>

          <Card
            title="Needs attention"
            subtitle="Products requiring operator review"
            action={
              !attention.isLoading && !attention.isError ? (
                <Chip
                  size="small"
                  color="warning"
                  label={formatNumber(attention.data?.total ?? 0)}
                />
              ) : undefined
            }
          >
            {attention.isLoading ? (
              <LoadingSkeleton lines={3} height={44} />
            ) : attention.isError ? (
              <InlineQueryError
                title="Attention queue failed to load"
                error={attention.error}
                onRetry={() => attention.refetch()}
              />
            ) : (attention.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                title="All clear"
                description="No products currently need attention."
                compact
              />
            ) : (
              <Stack>
                {attention.data?.items.map((product: Product) => (
                  <AttentionRow
                    key={product.id}
                    product={product}
                    onOpen={() => navigate(`/products/${product.id}`)}
                  />
                ))}
              </Stack>
            )}
          </Card>
        </Stack>
      </Box>

      <Box sx={{ mt: 2.5 }}>
        <Card
          title="Recent workspace activity"
          subtitle="Hermes events available from the current workspace feed"
          action={
            <Button size="small" onClick={() => navigate('/hermes')}>
              Open activity
            </Button>
          }
          contentSx={{ pt: 1 }}
        >
          {recent.isLoading ? (
            <LoadingSkeleton lines={4} height={48} />
          ) : recent.isError ? (
            <InlineQueryError
              title="Recent activity failed to load"
              error={recent.error}
              onRetry={() => recent.refetch()}
            />
          ) : eventSections.timeline.length === 0 ? (
            <EmptyState
              title="No recent events"
              description="Hermes workspace activity will appear here."
              compact
            />
          ) : (
            <Stack>
              {eventSections.timeline.map((event) => (
                <HermesEventRow
                  key={event.id}
                  event={event}
                  onOpen={() => navigate('/hermes')}
                  compact
                />
              ))}
            </Stack>
          )}
        </Card>
      </Box>
    </Box>
  );
};

export default DashboardPage;
