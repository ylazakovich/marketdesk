// Hermes activity feed: filter by status/severity, review event cards with
// approval actions, and trigger a fresh analysis run.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Chip, MenuItem, Select, Stack, Tab, Tabs, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import type { HermesEvent, HermesEventStatus, HermesSeverity } from '@shared/types';
import { HERMES_EVENT_STATUS_LIST, HERMES_SEVERITY_LIST } from '@shared/constants';
import { useHermesEvents, useRunHermes } from '../services/hooks/index.js';
import type { HermesEventListParams } from '../state/api/index.js';
import { useAppDispatch } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
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
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<HermesEventStatus[]>([]);
  const [severityFilter, setSeverityFilter] = useState<HermesSeverity[]>([]);
  const [activityTab, setActivityTab] = useState<'all' | 'suggestions' | 'alerts' | 'completed'>('all');

  const params = useMemo<HermesEventListParams>(() => {
    const p: HermesEventListParams = { sort: '-createdAt', limit: 50 };
    if (statusFilter.length) p.status = statusFilter;
    if (severityFilter.length) p.severity = severityFilter;
    return p;
  }, [statusFilter, severityFilter]);

  const { data, isLoading, isFetching, isError, error, refetch } = useHermesEvents(params);
  const [runHermes, { isLoading: running }] = useRunHermes();

  const events: HermesEvent[] = data?.items ?? [];
  const isCompletedEvent = (event: HermesEvent): boolean => event.status === 'applied' || event.status === 'dismissed';
  const visibleEvents = useMemo(() => {
    if (activityTab === 'completed') return events.filter(isCompletedEvent);
    if (activityTab === 'alerts') return events.filter((event) => event.severity === 'critical' || event.severity === 'warning');
    if (activityTab === 'suggestions') return events.filter((event) => event.status === 'pending_review');
    return events;
  }, [activityTab, events]);
  const pendingCount = events.filter((event) => event.status === 'pending_review').length;
  const completedCount = events.filter(isCompletedEvent).length;
  const listingSuggestionCount = events.filter((event) => event.type === 'create_listing').length;
  const estimatedReviewMinutes = events.length === 0 ? 0 : events.length * 6;

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
      <Card
        sx={{ mb: 2.5, background: (t) => `linear-gradient(135deg, ${t.palette.primary.dark}, ${t.palette.primary.main})`, color: 'primary.contrastText' }}
        contentSx={{ p: 3 }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ md: 'center' }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <AutoAwesomeIcon />
              <Typography variant="h5" sx={{ fontWeight: 800 }}>Hermes AI agent</Typography>
              <Chip size="small" label="Active" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'inherit' }} />
            </Stack>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              Monitoring listings and surfacing suggestions that need review before marketplace side effects.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" color="secondary" onClick={() => navigate('/settings')}>
              Configure
            </Button>
            <Button variant="outlined" color="inherit" startIcon={<AutoAwesomeIcon />} onClick={handleRun} disabled={running}>
              {running ? 'Running…' : 'Run Hermes'}
            </Button>
          </Stack>
        </Stack>
      </Card>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2.5 }}>
        {[
          ['Loaded feed actions', String(events.length)],
          ['Awaiting review', String(pendingCount)],
          ['Loaded listing suggestions', String(listingSuggestionCount)],
          ['Estimated review effort', `${estimatedReviewMinutes} min`],
        ].map(([label, value]) => (
          <Card key={label} sx={{ flex: 1 }} contentSx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography>
          </Card>
        ))}
      </Stack>

      <Card sx={{ mb: 2.5 }} contentSx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', md: 'center' }}
          justifyContent="space-between"
        >
          <Tabs value={activityTab} onChange={(_e, value) => setActivityTab(value)} variant="scrollable" allowScrollButtonsMobile>
            <Tab value="all" label="All activity" />
            <Tab value="suggestions" label="Suggestions" />
            <Tab value="alerts" label="Alerts" />
            <Tab value="completed" label={`Completed (${completedCount})`} />
          </Tabs>
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
        </Stack>
      </Card>

      {isError ? (
        <ErrorRetry error={error} onRetry={refetch} />
      ) : isLoading || isFetching ? (
        <LoadingSkeleton lines={4} height={120} />
      ) : visibleEvents.length === 0 ? (
        <EmptyState
          title="No Hermes activity"
          description="Run Hermes or change filters to see suggestions, alerts, and completed actions."
          icon={<AutoAwesomeIcon sx={{ fontSize: 48 }} />}
        />
      ) : (
        <Stack spacing={2}>
          {visibleEvents.map((event: HermesEvent) => (
            <HermesEventCard key={event.id} event={event} onResolved={refetch} />
          ))}
        </Stack>
      )}
    </Box>
  );
};

export default HermesActivityPage;
