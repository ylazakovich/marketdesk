// Marketplaces grid: connection status, sync mode, last-sync/error info, and
// sync / connect actions per marketplace.
import React, { useState } from 'react';
import {
  Box,
  Button,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import LinkIcon from '@mui/icons-material/Link';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { Marketplace, MarketplaceAccountStatus, SyncMode } from '@shared/types';
import { SYNC_MODE_LIST, MARKETPLACE_NAMES } from '@shared/constants';
import {
  useMarketplaces,
  useSyncMarketplace,
  useConnectMarketplace,
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

const MarketplacesPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const { data, isLoading, isError, error, refetch } = useMarketplaces();
  const [syncMarketplace] = useSyncMarketplace();
  const [connectMarketplace] = useConnectMarketplace();
  const [updateMarketplace] = useUpdateMarketplace();
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const handleConnect = async (m: Marketplace) => {
    setBusyId(m.id);
    try {
      await connectMarketplace({ id: m.id }).unwrap();
      dispatch(enqueueToast({ message: `${m.name} connected.`, severity: 'success' }));
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
              <Card key={m.id}>
                <Stack spacing={1.5}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: 2,
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          bgcolor: 'action.hover',
                          color: 'text.primary',
                        }}
                      >
                        {(MARKETPLACE_NAMES[m.key] ?? m.key).slice(0, 2).toUpperCase()}
                      </Box>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {m.name || MARKETPLACE_NAMES[m.key]}
                        </Typography>
                        <ConnectionBadge status={connectionStatus(m)} />
                      </Box>
                    </Stack>
                  </Stack>

                  <Stack spacing={0.75} sx={{ color: 'text.secondary' }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2">Last sync</Typography>
                      <Typography variant="body2" color="text.primary">
                        {m.lastSyncAt ? formatDateTime(m.lastSyncAt) : 'Never'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2">Errors</Typography>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        {m.errorCount > 0 && (
                          <ErrorOutlineIcon sx={{ fontSize: 16, color: 'error.main' }} />
                        )}
                        <Typography
                          variant="body2"
                          color={m.errorCount > 0 ? 'error.main' : 'text.primary'}
                        >
                          {m.errorCount}
                        </Typography>
                      </Stack>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2">Capacity</Typography>
                      <Typography variant="body2" color="text.primary">
                        {m.capacity}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Select
                    size="small"
                    value={m.syncMode}
                    onChange={(e) => handleSyncMode(m, e)}
                    disabled={!m.connected}
                    fullWidth
                  >
                    {SYNC_MODE_LIST.map((mode) => (
                      <MenuItem key={mode} value={mode}>
                        {SYNC_MODE_LABELS[mode]}
                      </MenuItem>
                    ))}
                  </Select>

                  <Stack direction="row" spacing={1}>
                    {m.connected ? (
                      <Button
                        variant="contained"
                        startIcon={<SyncIcon />}
                        onClick={() => handleSync(m)}
                        disabled={busy}
                        fullWidth
                      >
                        {busy ? 'Syncing…' : 'Sync now'}
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        startIcon={<LinkIcon />}
                        onClick={() => handleConnect(m)}
                        disabled={busy}
                        fullWidth
                      >
                        {busy ? 'Connecting…' : 'Connect'}
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default MarketplacesPage;
