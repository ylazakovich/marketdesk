// Card for a single Hermes event: severity, type, title/detail, the typed
// proposedChange diff, autonomy decision, and (optionally) approval controls.
import React from 'react';
import { Alert, Box, Button, Card, Chip, Divider, Stack, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import type {
  CategoryRecreationChangePayload,
  CategoryRecreationOperationAction,
  HermesEvent,
  ProposedChange,
} from '@shared/types';
import { MARKETPLACE_NAMES } from '@shared/constants';
import { useAppSelector } from '../../state/hooks.js';
import { useExecuteCategoryRecreationOperation } from '../../services/hooks/index.js';
import { useAppDispatch } from '../../state/hooks.js';
import { enqueueToast } from '../../state/slices/uiSlice.js';
import { formatCurrency, formatDate, formatRelativeTime } from '../../utils/formatters.js';
import { hermesTypeLabel } from '../../utils/labels.js';
import { HermesSeverityBadge, HermesStatusBadge, AutonomyDecisionBadge } from '../common/Badge.js';
import { ApprovalButtons } from './ApprovalButtons.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';

export interface HermesEventCardProps {
  event: HermesEvent;
  showActions?: boolean;
  onResolved?: () => void;
  approveLabel?: string;
  successMessage?: string;
}

function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

const operationStatusLabel = (status: string) => status.replace(/_/g, ' ');

export interface CategoryRecreationReviewProps {
  change: CategoryRecreationChangePayload;
  onAction?: (
    intentId: string,
    action: CategoryRecreationOperationAction,
    operation: 'delist' | 'recreate',
  ) => void;
}

export const CategoryRecreationReview: React.FC<CategoryRecreationReviewProps> = ({
  change,
  onAction,
}) => {
  const [delist, recreate] = change.operations;
  const category = (label: string, value: CategoryRecreationChangePayload['currentCategory']) => (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>{value.path.join(' → ')}</Typography>
      <Typography variant="caption" color="text.secondary">
        Provider category ID: {value.providerCategoryId} · Confidence: {value.confidence}
      </Typography>
    </Box>
  );
  const actions = (
    operation: typeof delist | typeof recreate,
    kind: 'delist' | 'recreate',
  ) => operation.availableActions?.length ? (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {operation.availableActions.map((action) => (
        <Button
          key={`${operation.intentId}:${action.kind}`}
          size="small"
          variant="outlined"
          disabled={!onAction}
          onClick={() => onAction?.(operation.intentId, action, kind)}
        >
          {action.label ?? `${action.kind} ${kind}`}
        </Button>
      ))}
    </Stack>
  ) : (
    <Typography variant="caption" color="text.secondary">
      No durable {kind} action is available from the server yet.
    </Typography>
  );

  return (
    <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Stack spacing={1.5}>
        <Alert severity="warning">
          OLX category changes are not a normal update. There is no combined Apply action; delist and recreate must be reviewed and audited separately.
        </Alert>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          divider={<Divider flexItem orientation="vertical" />}
        >
          {category('Current OLX category', change.currentCategory)}
          {category('Proposed OLX category', change.proposedCategory)}
        </Stack>
        <Divider />
        <Stack spacing={0.75}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle2">Delist current advert</Typography>
            <Chip size="small" label={operationStatusLabel(delist.status)} />
          </Stack>
          <Typography variant="body2">
            Ending or deleting the advert does not restore the publication quota unit already consumed.
          </Typography>
          {delist.failureReason && <Alert severity="error">{delist.failureReason}</Alert>}
          {actions(delist, 'delist')}
        </Stack>
        <Divider />
        <Stack spacing={0.75}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle2">Recreate advert</Typography>
            <Chip size="small" label={operationStatusLabel(recreate.status)} />
          </Stack>
          {recreate.quota ? (
            <Stack spacing={0.5}>
              <Typography variant="body2">
                Quota cycle: {formatDate(recreate.quota.cycleStartedAt, 'UTC', 'en-GB')} – {formatDate(recreate.quota.cycleEndsAt, 'UTC', 'en-GB')}
              </Typography>
              <Typography variant="body2">
                Remaining: {recreate.quota.remaining == null ? 'Unknown' : recreate.quota.remaining}
              </Typography>
              <Chip
                size="small"
                color={recreate.quota.paidRisk ? 'error' : 'default'}
                label={recreate.quota.paidRisk ? 'Paid placement risk' : `Quota ${operationStatusLabel(recreate.quota.status)}`}
                sx={{ alignSelf: 'flex-start' }}
              />
              {recreate.quota.reason && <Alert severity="warning">{recreate.quota.reason}</Alert>}
            </Stack>
          ) : (
            <Alert severity="warning">
              Quota state and cycle are unknown. Zero-spend recreation remains blocked; a visible 30-day advert lifetime is not proof of a free slot.
            </Alert>
          )}
          {recreate.failureReason && <Alert severity="error">{recreate.failureReason}</Alert>}
          {actions(recreate, 'recreate')}
        </Stack>
      </Stack>
    </Box>
  );
};

const ProposedChangeDiff: React.FC<{
  change: ProposedChange;
  currency: string;
  onCategoryAction?: CategoryRecreationReviewProps['onAction'];
}> = ({
  change,
  currency,
  onCategoryAction,
}) => {
  if (!change) return null;

  const arrow = <ArrowForwardIcon sx={{ fontSize: 16, color: 'text.disabled' }} />;
  const wrap = (content: React.ReactNode) => (
    <Box
      sx={{
        mt: 1.5,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        bgcolor: 'action.hover',
        border: (t) => `1px dashed ${t.palette.divider}`,
      }}
    >
      {content}
    </Box>
  );

  switch (change.kind) {
    case 'price':
      return wrap(
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="caption" color="text.secondary">Price</Typography>
          <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'text.secondary' }}>
            {formatCurrency(change.from, currency)}
          </Typography>
          {arrow}
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatCurrency(change.to, currency)}</Typography>
        </Stack>,
      );
    case 'title':
      return wrap(
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">Title</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">{truncate(change.from)}</Typography>
            {arrow}
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{truncate(change.to)}</Typography>
          </Stack>
        </Stack>,
      );
    case 'description':
      return wrap(
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">Description</Typography>
          <Typography variant="body2">{truncate(change.to, 140)}</Typography>
        </Stack>,
      );
    case 'relist':
      return wrap(
        <Typography variant="body2">
          Relist {change.listingIds.length} listing{change.listingIds.length === 1 ? '' : 's'}
        </Typography>,
      );
    case 'create_listing':
      return wrap(
        <Typography variant="body2">
          Create listing on <strong>{MARKETPLACE_NAMES[change.marketplaceKey]}</strong>
        </Typography>,
      );
    case 'category_recreation':
      return <CategoryRecreationReview change={change} onAction={onCategoryAction} />;
  }
};

export const HermesEventCard: React.FC<HermesEventCardProps> = ({
  event,
  showActions = true,
  onResolved,
  approveLabel,
  successMessage,
}) => {
  const currency = useAppSelector((s) => s.workspace.currency);
  const dispatch = useAppDispatch();
  const [executeOperation, { isLoading: executingOperation }] = useExecuteCategoryRecreationOperation();
  const [pendingOperation, setPendingOperation] = React.useState<{
    action: CategoryRecreationOperationAction;
    operation: 'delist' | 'recreate';
  } | null>(null);
  const isCategoryRecreation = event.proposedChange?.kind === 'category_recreation';

  const confirmOperation = async () => {
    if (!pendingOperation) return;
    const { action, operation } = pendingOperation;
    try {
      await executeOperation({
        action,
        operation,
        confirmation: operation === 'delist'
          ? { kind: 'delist', deletionDoesNotRestoreQuota: true }
          : { kind: 'recreate', newPublicationConsumesQuota: true, paidRiskAccepted: true },
      }).unwrap();
      dispatch(enqueueToast({
        message: `${operation === 'delist' ? 'Delist' : 'Recreate'} decision recorded. Provider completion is tracked separately.`,
        severity: 'success',
      }));
      setPendingOperation(null);
      onResolved?.();
    } catch (error) {
      const message = error && typeof error === 'object' && 'data' in error
        ? (error as { data?: { error?: { message?: string } } }).data?.error?.message
        : undefined;
      dispatch(enqueueToast({ message: message ?? 'Category operation was not accepted.', severity: 'error' }));
    }
  };

  return (
    <Card sx={{ p: 2.25 }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 2,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'primary.contrastText',
            background: (t) =>
              `linear-gradient(135deg, ${t.palette.primary.light}, ${t.palette.primary.dark})`,
          }}
        >
          <AutoAwesomeIcon fontSize="small" />
        </Box>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 0.5 }}>
            <HermesSeverityBadge severity={event.severity} />
            <HermesStatusBadge status={event.status} />
            {event.autonomyDecision && <AutonomyDecisionBadge decision={event.autonomyDecision} />}
            <Chip size="small" variant="outlined" label={hermesTypeLabel(event.type)} sx={{ fontWeight: 500 }} />
          </Stack>

          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{event.title}</Typography>
          {event.detail && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{event.detail}</Typography>
          )}

          <ProposedChangeDiff
            change={event.proposedChange}
            currency={currency}
            onCategoryAction={(_intentId, action, operation) => setPendingOperation({ action, operation })}
          />

          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
            sx={{ mt: 1.5 }}
            flexWrap="wrap"
          >
            <Typography variant="caption" color="text.secondary">{formatRelativeTime(event.createdAt)}</Typography>
            {showActions && !isCategoryRecreation && (
              <ApprovalButtons
                event={event}
                onResolved={onResolved}
                approveLabel={approveLabel}
                successMessage={successMessage}
              />
            )}
          </Stack>
        </Box>
      </Stack>
      <ConfirmDialog
        open={Boolean(pendingOperation)}
        title={pendingOperation?.operation === 'delist' ? 'Confirm delist review?' : 'Confirm recreate review?'}
        message={pendingOperation?.operation === 'delist'
          ? 'This records a separate delist decision. Ending the advert does not restore its consumed quota unit, and this confirmation does not mean OLX has completed the action.'
          : 'This records a separate recreate decision for a new publication. It consumes quota and may incur a paid placement; this confirmation does not mean OLX has completed publication.'}
        confirmLabel={pendingOperation?.operation === 'delist' ? 'Confirm delist decision' : 'Accept paid risk and confirm recreate'}
        confirmColor="error"
        loading={executingOperation}
        onConfirm={confirmOperation}
        onCancel={() => setPendingOperation(null)}
      />
    </Card>
  );
};

export default HermesEventCard;
