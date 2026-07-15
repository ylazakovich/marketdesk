// Marketplaces grid: connection status, sync mode, last-sync/error info, and
// sync / connect actions per marketplace.
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import LinkIcon from '@mui/icons-material/Link';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import type { Marketplace, MarketplaceAccountStatus, SyncMode } from '@shared/types';
import type { MarketplaceImportPreview } from '../state/api/index.js';
import { MARKETPLACE_NAMES } from '@shared/constants';
import {
  useMarketplaces,
  useSyncMarketplace,
  useConnectMarketplace,
  useCheckMarketplace,
  useImportMarketplacePreview,
  useUpdateMarketplace,
} from '../services/hooks/index.js';
import { useAppDispatch } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { formatDateTime } from '../utils/formatters.js';
import { SYNC_MODE_LABELS } from '../utils/labels.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { Card } from '../components/common/Card.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ErrorRetry } from '../components/common/ErrorRetry.js';
import { ConnectionBadge } from '../components/common/Badge.js';
import { LoadingSkeleton } from '../components/common/Skeleton.js';

const SUPPORTED_SYNC_MODES: SyncMode[] = ['manual', 'hourly'];

const SYNC_MODE_HELP: Record<SyncMode, string> = {
  manual: 'Sync only when you start it manually.',
  hourly: 'Run automatic synchronization once per hour.',
  realtime: 'Real-time sync is not available for the current OLX integration yet.',
};

function connectionStatus(m: Marketplace): MarketplaceAccountStatus {
  if (m.errorCount > 0) return 'error';
  return m.connected ? 'connected' : 'disconnected';
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

function marketplaceBrandLabel(m: Marketplace): string {
  return MARKETPLACE_NAMES[m.key] ?? m.name ?? m.key.toUpperCase();
}

function marketplaceLogoText(m: Marketplace): string {
  if (m.key === 'olx') return 'OLX';
  return marketplaceBrandLabel(m).slice(0, 2).toUpperCase();
}

function syncModeOptions(current: SyncMode): SyncMode[] {
  return SUPPORTED_SYNC_MODES.includes(current)
    ? SUPPORTED_SYNC_MODES
    : [...SUPPORTED_SYNC_MODES, current];
}

export interface MarketplaceCardProps {
  marketplace: Marketplace;
  busy: boolean;
  onSync: (marketplace: Marketplace) => void;
  onConnect: (marketplace: Marketplace) => void;
  onImportPreview: (marketplace: Marketplace) => void;
  onSyncMode: (marketplace: Marketplace, event: SelectChangeEvent<SyncMode>) => void;
}

export const MarketplaceCard: React.FC<MarketplaceCardProps> = ({
  marketplace: m,
  busy,
  onSync,
  onConnect,
  onImportPreview,
  onSyncMode,
}) => {
  const brandLabel = marketplaceBrandLabel(m);
  const syncLabelId = `marketplace-${m.id}-sync-mode-label`;
  const syncSelectId = `marketplace-${m.id}-sync-mode`;
  return (
    <Card>
      <Stack spacing={1.75}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              aria-label={`${brandLabel} marketplace logo`}
              sx={{
                width: 48,
                height: 40,
                borderRadius: 2,
                display: 'grid',
                placeItems: 'center',
                fontWeight: 900,
                letterSpacing: -0.5,
                bgcolor: m.key === 'olx' ? '#002f34' : 'action.hover',
                color: m.key === 'olx' ? '#23e5db' : 'text.primary',
                flexShrink: 0,
              }}
            >
              {marketplaceLogoText(m)}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
                {m.name || brandLabel}
              </Typography>
              <ConnectionBadge status={connectionStatus(m)} />
            </Box>
          </Stack>
        </Stack>

        <Stack spacing={1} sx={{ color: 'text.secondary' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.5}>
            <Typography variant="body2">Last sync</Typography>
            <Typography variant="body2" color="text.primary" sx={{ textAlign: { sm: 'right' } }}>
              {m.lastSyncAt ? formatDateTime(m.lastSyncAt) : 'Never synced'}
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.5}>
            <Typography variant="body2">Synchronization</Typography>
            <Typography variant="body2" color="text.primary" sx={{ textAlign: { sm: 'right' } }}>
              {SYNC_MODE_LABELS[m.syncMode]}
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.5}>
            <Typography variant="body2">Sync errors</Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={{ sm: 'flex-end' }}>
              {m.errorCount > 0 && <ErrorOutlineIcon sx={{ fontSize: 16, color: 'error.main' }} />}
              <Typography variant="body2" color={m.errorCount > 0 ? 'error.main' : 'success.main'}>
                {m.errorCount > 0 ? `${m.errorCount} needs review` : 'No errors'}
              </Typography>
            </Stack>
          </Stack>
        </Stack>

        {m.errorCount > 0 && (
          <Button variant="outlined" color="error" size="small" startIcon={<ErrorOutlineIcon />}>
            Review sync issues
          </Button>
        )}

        <FormControl size="small" fullWidth disabled={!m.connected}>
          <InputLabel id={syncLabelId}>Sync mode</InputLabel>
          <Select
            labelId={syncLabelId}
            id={syncSelectId}
            label="Sync mode"
            value={m.syncMode}
            onChange={(e) => onSyncMode(m, e)}
          >
            {syncModeOptions(m.syncMode).map((mode) => (
              <MenuItem key={mode} value={mode} disabled={!SUPPORTED_SYNC_MODES.includes(mode)}>
                {SYNC_MODE_LABELS[mode]}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>{SYNC_MODE_HELP[m.syncMode]}</FormHelperText>
        </FormControl>

        <Stack direction="row" spacing={1}>
          {m.connected ? (
            <>
              <Button
                variant="contained"
                startIcon={<SyncIcon />}
                onClick={() => onSync(m)}
                disabled={busy}
                fullWidth
              >
                {busy ? 'Syncing…' : 'Sync now'}
              </Button>
              {m.key === 'olx' && (
                <Button
                  variant="outlined"
                  onClick={() => onImportPreview(m)}
                  disabled={busy}
                  fullWidth
                >
                  Preview import
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="contained"
              startIcon={<LinkIcon />}
              onClick={() => onConnect(m)}
              disabled={busy}
              fullWidth
            >
              {busy ? 'Opening OLX…' : 'Connect with OLX'}
            </Button>
          )}
        </Stack>
      </Stack>
    </Card>
  );
};

const MarketplacesPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const handledOAuthResult = useRef<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useMarketplaces();
  const [syncMarketplace] = useSyncMarketplace();
  const [connectMarketplace] = useConnectMarketplace();
  const [checkMarketplace] = useCheckMarketplace();
  const [importMarketplacePreview] = useImportMarketplacePreview();
  const [updateMarketplace] = useUpdateMarketplace();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<MarketplaceImportPreview | null>(null);

  useEffect(() => {
    const oauthResult = searchParams.get('oauth');
    const marketplaceId = searchParams.get('marketplaceId');
    const resultKey = `${oauthResult ?? ''}:${marketplaceId ?? ''}:${searchParams.get('code') ?? ''}`;
    if (!oauthResult || handledOAuthResult.current === resultKey) return;
    handledOAuthResult.current = resultKey;

    const cleanParams = new URLSearchParams(searchParams);
    cleanParams.delete('oauth');
    cleanParams.delete('marketplaceId');
    cleanParams.delete('code');
    setSearchParams(cleanParams, { replace: true });

    if (oauthResult !== 'success' || !marketplaceId) {
      dispatch(
        enqueueToast({
          message: 'OLX authorization was not completed. Please try again.',
          severity: 'error',
        }),
      );
      return;
    }

    setBusyId(marketplaceId);
    void checkMarketplace(marketplaceId)
      .unwrap()
      .then((status) => {
        if (!status.connected) throw new Error('OLX account is not connected');
        dispatch(enqueueToast({ message: 'OLX account connected.', severity: 'success' }));
        void refetch();
      })
      .catch((err: unknown) => {
        dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
      })
      .finally(() => setBusyId(null));
  }, [checkMarketplace, dispatch, refetch, searchParams, setSearchParams]);

  const handleSync = async (m: Marketplace) => {
    setBusyId(m.id);
    try {
      await syncMarketplace(m.id).unwrap();
      dispatch(enqueueToast({ message: `${m.name} sync started.`, severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    } finally {
      setBusyId(null);
    }
  };

  const handleImportPreview = async (m: Marketplace) => {
    setBusyId(m.id);
    try {
      const preview = await importMarketplacePreview({
        id: m.id,
        statuses: ['active', 'new', 'moderation', 'limited', 'expired', 'removed', 'rejected'],
      }).unwrap();
      setImportPreview(preview);
      dispatch(
        enqueueToast({
          message: `OLX preview found ${preview.totals.discovered} advert(s).`,
          severity: 'success',
        }),
      );
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    } finally {
      setBusyId(null);
    }
  };

  const handleConnect = async (m: Marketplace) => {
    setBusyId(m.id);
    try {
      const oauth = await connectMarketplace({ id: m.id }).unwrap();
      window.location.assign(oauth.authorizationUrl);
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    } finally {
      setBusyId(null);
    }
  };

  const handleSyncMode = async (m: Marketplace, e: SelectChangeEvent<SyncMode>) => {
    const syncMode = e.target.value as SyncMode;
    try {
      await updateMarketplace({ id: m.id, patch: { syncMode } }).unwrap();
      dispatch(enqueueToast({ message: `${m.name} sync mode updated.`, severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  return (
    <Box>
      <PageHeader
        title="Marketplaces"
        subtitle="Connect and sync your channels."
        actions={
          <Button variant="outlined" startIcon={<SyncIcon />} onClick={() => refetch()}>
            Refresh
          </Button>
        }
      />

      {isError ? (
        <ErrorRetry error={error} onRetry={refetch} />
      ) : isLoading ? (
        <LoadingSkeleton lines={4} height={160} />
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          title="No marketplaces"
          description="Marketplace channels will appear here once your workspace is provisioned."
        />
      ) : (
        <>
          {importPreview && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle2">Read-only OLX import preview</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`Discovered: ${importPreview.totals.discovered}`} />
                  <Chip size="small" color="success" label={`New: ${importPreview.totals.new}`} />
                  <Chip size="small" label={`Already imported: ${importPreview.totals.already_imported}`} />
                  <Chip size="small" color="warning" label={`Unsupported: ${importPreview.totals.unsupported}`} />
                </Stack>
                {importPreview.items.slice(0, 5).map((item) => (
                  <Typography key={item.externalListingId} variant="body2">
                    {item.title} — {item.status}
                    {item.remoteStatus ? ` (${item.remoteStatus})` : ''}
                    {item.warnings.length > 0 ? ` · ${item.warnings.join(', ')}` : ''}
                  </Typography>
                ))}
                {importPreview.items.length > 5 && (
                  <Typography variant="body2" color="text.secondary">
                    Showing first 5 of {importPreview.items.length} adverts.
                  </Typography>
                )}
              </Stack>
            </Alert>
          )}
          <Box
            sx={{
              display: 'grid',
              gap: 2.5,
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' },
            }}
          >
          {data?.map((m) => {
            const busy = busyId === m.id;
            return (
              <MarketplaceCard
                key={m.id}
                marketplace={m}
                busy={busy}
                onSync={handleSync}
                onConnect={handleConnect}
                onImportPreview={handleImportPreview}
                onSyncMode={handleSyncMode}
              />
            );
          })}
          </Box>
        </>
      )}
    </Box>
  );
};

export default MarketplacesPage;
