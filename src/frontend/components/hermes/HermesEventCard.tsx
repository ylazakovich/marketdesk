// Card for a single Hermes event: severity, type, title/detail, the typed
// proposedChange diff, autonomy decision, and (optionally) approval controls.
import React from 'react';
import { Alert, Box, Button, Card, Chip, Divider, Stack, Tooltip, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CategoryIcon from '@mui/icons-material/CategoryOutlined';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import PhotoIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import ReplayIcon from '@mui/icons-material/Replay';
import RuleIcon from '@mui/icons-material/RuleOutlined';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
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
import {
  hermesTypeLabel,
  isSeoRecommendation,
  recommendationFieldLabel,
} from '../../utils/labels.js';
import { HermesSeverityBadge, HermesStatusBadge, AutonomyDecisionBadge } from '../common/Badge.js';
import { ApprovalButtons } from './ApprovalButtons.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';

export interface HermesEventCardProps {
  event: HermesEvent;
  showActions?: boolean;
  onResolved?: () => void;
  approveLabel?: string;
  successMessage?: string;
  variant?: 'default' | 'compactReview';
}

const operationStatusLabel = (status: string) => status.replace(/_/g, ' ');

const EVENT_ICONS: Record<HermesEvent['type'], React.ElementType> = {
  suggested_lower_price: TrendingDownIcon,
  suggested_higher_price: TrendingUpIcon,
  needs_relisting: ReplayIcon,
  competitor_price_detected: CompareArrowsIcon,
  suggested_better_title: EditIcon,
  suggested_more_photos: PhotoIcon,
  create_listing: StorefrontIcon,
  update_description: DescriptionIcon,
  olx_category_mismatch: CategoryIcon,
  product_category_conflict: RuleIcon,
  relist: ReplayIcon,
};

export const HermesEventTypeIcon: React.FC<Pick<HermesEvent, 'type' | 'severity'>> = ({ type, severity }) => {
  const Icon = EVENT_ICONS[type] ?? AutoAwesomeIcon;
  const paletteColor = severity === 'critical' ? 'error' : severity;
  return (
    <Box
      role="img"
      aria-label={`${hermesTypeLabel(type)}, ${severity} severity`}
      sx={{
        width: 36,
        height: 36,
        borderRadius: 2,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        color: `${paletteColor}.contrastText`,
        bgcolor: `${paletteColor}.main`,
      }}
    >
      <Icon fontSize="small" aria-hidden="true" />
    </Box>
  );
};

export function hermesLifecycleCopy(status: HermesEvent['status']): string {
  switch (status) {
    case 'pending_decision': return 'Hermes is evaluating whether this change requires review.';
    case 'pending_review': return 'A recorded decision is required before MarketDesk can continue.';
    case 'applying': return 'The approved change is queued or applying; provider completion is not yet confirmed.';
    case 'applied': return 'MarketDesk recorded this action as completed.';
    case 'dismissed': return 'This suggestion was dismissed without applying the proposed change.';
    case 'failed': return 'The action failed. Review the details before deciding what to do next.';
    case 'reverting': return 'The reversal is in progress; completion is not yet confirmed.';
    case 'reverted': return 'MarketDesk recorded the action as reverted.';
  }
}

export function hermesEventDismissOnly(event: HermesEvent): boolean {
  return !event.proposedChange || event.type === 'create_listing' || event.type === 'product_category_conflict';
}

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
  const category = (
    label: string,
    value: CategoryRecreationChangePayload['currentCategory'] | null,
  ) => value ? (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>{value.path.join(' → ')}</Typography>
      <Typography variant="caption" color="text.secondary">
        Provider category ID: {value.providerCategoryId} · Confidence: {value.confidence}
      </Typography>
    </Box>
  ) : (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>Not selected</Typography>
      <Typography variant="caption" color="warning.main">
        Select and verify an exact OLX leaf category before recreation can be reviewed.
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

export const ProposedChangeDiff: React.FC<{
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
    case 'description': {
      const field = change.kind === 'title' ? 'Title' : 'Description';
      return (
        <Box
          aria-label={`${field} proposed change`}
          sx={{
            mt: 1.25,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          <Typography variant="caption" sx={{ display: 'block', px: 1.25, py: 0.75, bgcolor: 'action.hover', fontWeight: 800 }}>
            {field} · proposed diff
          </Typography>
          <Box sx={{ px: 1.25, py: 1, bgcolor: 'error.main', color: 'error.contrastText', overflowWrap: 'anywhere' }}>
            <Typography component="span" variant="caption" sx={{ display: 'inline-block', minWidth: 72, fontWeight: 900 }}>− Before</Typography>
            <Typography component="span" variant="body2" sx={{ fontFamily: 'inherit' }}>{change.from}</Typography>
          </Box>
          <Box sx={{ px: 1.25, py: 1, bgcolor: 'success.main', color: 'success.contrastText', overflowWrap: 'anywhere' }}>
            <Typography component="span" variant="caption" sx={{ display: 'inline-block', minWidth: 72, fontWeight: 900 }}>+ After</Typography>
            <Typography component="span" variant="body2" sx={{ fontFamily: 'inherit' }}>{change.to}</Typography>
          </Box>
        </Box>
      );
    }
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
    case 'product_category_conflict':
      return wrap(
        <Stack spacing={0.75}>
          <Typography variant="caption" color="text.secondary">
            Current category: {change.currentCategory}
          </Typography>
          {change.candidates.map((candidate) => (
            <Typography
              key={`${candidate.marketplaceId}:${candidate.listingId}:${candidate.providerCategoryId}`}
              variant="body2"
            >
              {candidate.marketplaceKey.toUpperCase()} · {candidate.path.join(' › ')} · ID {candidate.providerCategoryId}
            </Typography>
          ))}
        </Stack>,
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
  variant = 'default',
}) => {
  const currency = useAppSelector((s) => s.workspace.currency);
  const dispatch = useAppDispatch();
  const [executeOperation, { isLoading: executingOperation }] = useExecuteCategoryRecreationOperation();
  const [pendingOperation, setPendingOperation] = React.useState<{
    action: CategoryRecreationOperationAction;
    operation: 'delist' | 'recreate';
  } | null>(null);
  const isCategoryRecreation = event.proposedChange?.kind === 'category_recreation';
  const canReview = event.status === 'pending_review';
  const dismissOnly = hermesEventDismissOnly(event);

  const confirmOperation = async () => {
    if (!pendingOperation) return;
    const { action, operation } = pendingOperation;
    try {
      await executeOperation({
        action,
        operation,
      }).unwrap();
      dispatch(enqueueToast({
        message: action.kind === 'approve'
          ? `${operation === 'delist' ? 'Delist' : 'Recreate'} review approved.`
          : `${operation === 'delist' ? 'Delist' : 'Recreate'} execution completed.`,
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

  if (variant === 'compactReview') {
    const fieldLabel = recommendationFieldLabel(event);
    return (
      <Card data-variant="compact-review" sx={{ p: 1.5, borderColor: 'primary.main' }}>
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            {isSeoRecommendation(event) ? (
              <Tooltip title="SEO · listing search optimization" arrow>
                <Chip
                  size="small"
                  label="SEO"
                  aria-label="SEO, listing search optimization"
                  color="primary"
                  variant="outlined"
                  sx={{ fontWeight: 900 }}
                />
              </Tooltip>
            ) : (
              <Chip size="small" label={hermesTypeLabel(event.type)} variant="outlined" />
            )}
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 800 }}>
              {fieldLabel}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <HermesSeverityBadge severity={event.severity} />
            <HermesStatusBadge status={event.status} />
          </Stack>
          <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>
            {event.title}
          </Typography>
          <ProposedChangeDiff
            change={event.proposedChange}
            currency={currency}
          />
          {!event.proposedChange && (
            <Alert severity="info">No directly applicable product change. Review and dismiss this item.</Alert>
          )}
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" useFlexGap flexWrap="wrap">
            <Typography variant="caption" color="text.secondary">{formatRelativeTime(event.createdAt)}</Typography>
            {showActions && canReview && !isCategoryRecreation && (
              <ApprovalButtons
                event={event}
                onResolved={onResolved}
                approveLabel={approveLabel}
                successMessage={successMessage}
                dismissOnly={dismissOnly}
              />
            )}
          </Stack>
        </Stack>
      </Card>
    );
  }

  return (
    <Card sx={{ p: 2.25 }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <HermesEventTypeIcon type={event.type} severity={event.severity} />

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
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            {hermesLifecycleCopy(event.status)}
          </Typography>

          {event.productId && (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              justifyContent="space-between"
              sx={{ mt: 1.25, p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">Product context</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Related MarketDesk product</Typography>
              </Box>
              <Button component="a" href={`/products/${encodeURIComponent(event.productId)}`} size="small" variant="text">
                View product
              </Button>
            </Stack>
          )}

          <ProposedChangeDiff
            change={event.proposedChange}
            currency={currency}
            onCategoryAction={showActions
              ? (_intentId, action, operation) => setPendingOperation({ action, operation })
              : undefined}
          />
          {!event.proposedChange && event.status === 'pending_review' && (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              This recommendation has no directly applicable product change. Dismiss it after review;
              MarketDesk will not mark it as applied.
            </Alert>
          )}

          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
            sx={{ mt: 1.5 }}
            flexWrap="wrap"
          >
            <Typography variant="caption" color="text.secondary">{formatRelativeTime(event.createdAt)}</Typography>
            {showActions && canReview && !isCategoryRecreation && (
              <ApprovalButtons
                event={event}
                onResolved={onResolved}
                approveLabel={approveLabel}
                successMessage={successMessage}
                dismissOnly={dismissOnly}
              />
            )}
          </Stack>
        </Box>
      </Stack>
      <ConfirmDialog
        open={Boolean(pendingOperation)}
        title={pendingOperation?.action.kind === 'execute'
          ? `Execute ${pendingOperation.operation}?`
          : `Approve ${pendingOperation?.operation ?? 'operation'} review?`}
        message={pendingOperation?.action.kind === 'execute'
          ? pendingOperation.operation === 'delist'
            ? 'This will remove the current OLX advert. Deletion does not restore its consumed quota unit.'
            : 'This will create a new OLX advert only if the quota guard allows it. It may consume a publication unit; no paid-risk override is granted by this action.'
          : pendingOperation?.operation === 'delist'
            ? 'This approves the separate delist operation but does not contact OLX yet.'
            : 'This approves the separate recreate operation but does not publish yet. Execution remains quota-guarded.'}
        confirmLabel={pendingOperation?.action.kind === 'execute'
          ? `Execute ${pendingOperation.operation}`
          : `Approve ${pendingOperation?.operation ?? 'operation'}`}
        confirmColor="error"
        loading={executingOperation}
        onConfirm={confirmOperation}
        onCancel={() => setPendingOperation(null)}
      />
    </Card>
  );
};

export default HermesEventCard;
