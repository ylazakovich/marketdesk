// Hermes activity feed: filter by status/severity, review event cards with
// approval actions, and trigger a fresh analysis run.
import React, { useMemo, useState } from 'react';
import { Box, Button, MenuItem, Select, Stack } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import type { HermesEvent, HermesEventStatus, HermesSeverity } from '@shared/types';
import { HERMES_EVENT_STATUS_LIST, HERMES_SEVERITY_LIST } from '@shared/constants';
import { useHermesEvents, useRunHermes } from '../services/hooks/index.js';
import type { HermesEventListParams } from '../state/api/index.js';
import { useAppDispatch } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { Card } from '../components/common/Card.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ErrorRetry } from '../components/common/ErrorRetry.js';
import { LoadingSkeleton } from '../components/common/Skeleton.js';
import { HermesStatusBadge, HermesSeverityBadge } from '../components/common/Badge.js';
import { HermesEventCard } from '../components/hermes/index.js';

const STATUS_LABELS: Record<HermesEventStatus, string> = {
  pending_review: 'Pending review',
  applied: 'Applied',
  dismissed: 'Dismissed',
};

const SEVERITY_LABELS: Record<HermesSeverity, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  critical: 'Critical',
};

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

const HermesActivityPage: React.FC = () => {
  const dispatch = useAppDispatch();

  const [statusFilter, setStatusFilter] = useState<HermesEventStatus[]>([]);
  const [severityFilter, setSeverityFilter] = useState<HermesSeverity[]>([]);

  const params = useMemo<HermesEventListParams>(() => {
    const p: HermesEventListParams = { sort: '-createdAt', limit: 50 };
    if (statusFilter.length) p.status = statusFilter;
    if (severityFilter.length) p.severity = severityFilter;
    return p;
  }, [statusFilter, severityFilter]);

  const { data, isLoading, isFetching, isError, error, refetch } = useHermesEvents(params);
  const [runHermes, { isLoading: running }] = useRunHermes();

  const events = data?.items ?? [];

  const handleStatus = (e: SelectChangeEvent<HermesEventStatus[]>) => {
    const value = e.target.value;
    setStatusFilter(typeof value === 'string' ? (value.split(',') as HermesEventStatus[]) : value);
  };

  const handleSeverity = (e: SelectChangeEvent<HermesSeverity[]>) => {
    const value = e.target.value;
    setSeverityFilter(typeof value === 'string' ? (value.split(',') as HermesSeverity[]) : value);
  };

  const handleRun = async () => {
    try {
      const events = await runHermes({ trigger: 'manual' }).unwrap();
      dispatch(
        enqueueToast({
          message: `Hermes run complete — ${events.length} new suggestion(s).`,
          severity: 'success',
        }),
      );
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  return (
    <Box>
      <PageHeader
        title="Hermes AI"
        subtitle="Review and approve the autonomous agent's suggestions."
      />

      <Card sx={{ mb: 2.5 }} contentSx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', md: 'center' }}
          justifyContent="space-between"
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
          <Select
            size="small"
            multiple
            displayEmpty
            value={statusFilter}
            onChange={handleStatus}
            renderValue={(selected) =>
              selected.length === 0 ? (
                'All statuses'
              ) : (
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {selected.map((s) => (
                    <HermesStatusBadge key={s} status={s} />
                  ))}
                </Stack>
              )
            }
            sx={{ minWidth: 200 }}
          >
            {HERMES_EVENT_STATUS_LIST.map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </MenuItem>
            ))}
          </Select>
          <Select
            size="small"
            multiple
            displayEmpty
            value={severityFilter}
            onChange={handleSeverity}
            renderValue={(selected) =>
              selected.length === 0 ? (
                'All severities'
              ) : (
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {selected.map((s) => (
                    <HermesSeverityBadge key={s} severity={s} />
                  ))}
                </Stack>
              )
            }
            sx={{ minWidth: 200 }}
          >
            {HERMES_SEVERITY_LIST.map((s) => (
              <MenuItem key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </MenuItem>
            ))}
          </Select>
          </Stack>
          <Button
            variant="contained"
            startIcon={<AutoAwesomeIcon />}
            onClick={handleRun}
            disabled={running}
            sx={{ alignSelf: { xs: 'stretch', md: 'center' } }}
          >
            {running ? 'Running…' : 'Run Hermes'}
          </Button>
        </Stack>
      </Card>

      {isError ? (
        <ErrorRetry error={error} onRetry={refetch} />
      ) : isLoading || isFetching ? (
        <LoadingSkeleton lines={4} height={120} />
      ) : events.length === 0 ? (
        <EmptyState
          title="No Hermes activity"
          description="Run Hermes to generate optimisation suggestions for your listings."
          icon={<AutoAwesomeIcon sx={{ fontSize: 48 }} />}
          action={
            <Button variant="contained" startIcon={<AutoAwesomeIcon />} onClick={handleRun}>
              Run Hermes
            </Button>
          }
        />
      ) : (
        <Stack spacing={2}>
          {events.map((event: HermesEvent) => (
            <HermesEventCard key={event.id} event={event} onResolved={refetch} />
          ))}
        </Stack>
      )}
    </Box>
  );
};

export default HermesActivityPage;
