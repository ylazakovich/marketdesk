// Card for a single Hermes event: severity, type, title/detail, the typed
// proposedChange diff, autonomy decision, and (optionally) approval controls.
import React from 'react';
import { Box, Card, Chip, Stack, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import type { HermesEvent, ProposedChange } from '@shared/types';
import { MARKETPLACE_NAMES } from '@shared/constants';
import { useAppSelector } from '../../state/hooks.js';
import { formatCurrency, formatRelativeTime } from '../../utils/formatters.js';
import { hermesTypeLabel } from '../../utils/labels.js';
import { HermesSeverityBadge, HermesStatusBadge, AutonomyDecisionBadge } from '../common/Badge.js';
import { ApprovalButtons } from './ApprovalButtons.js';

export interface HermesEventCardProps {
  event: HermesEvent;
  showActions?: boolean;
  onResolved?: () => void;
}

function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

const ProposedChangeDiff: React.FC<{ change: ProposedChange; currency: string }> = ({
  change,
  currency,
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
          <Typography variant="caption" color="text.secondary">
            Price
          </Typography>
          <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'text.secondary' }}>
            {formatCurrency(change.from, currency)}
          </Typography>
          {arrow}
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {formatCurrency(change.to, currency)}
          </Typography>
        </Stack>,
      );
    case 'title':
      return wrap(
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Title
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary">
              {truncate(change.from)}
            </Typography>
            {arrow}
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {truncate(change.to)}
            </Typography>
          </Stack>
        </Stack>,
      );
    case 'description':
      return wrap(
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Description
          </Typography>
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
    default:
      return null;
  }
};

export const HermesEventCard: React.FC<HermesEventCardProps> = ({
  event,
  showActions = true,
  onResolved,
}) => {
  const currency = useAppSelector((s) => s.workspace.currency);

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
            <Chip
              size="small"
              variant="outlined"
              label={hermesTypeLabel(event.type)}
              sx={{ fontWeight: 500 }}
            />
          </Stack>

          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {event.title}
          </Typography>
          {event.detail && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {event.detail}
            </Typography>
          )}

          <ProposedChangeDiff change={event.proposedChange} currency={currency} />

          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
            sx={{ mt: 1.5 }}
            flexWrap="wrap"
          >
            <Typography variant="caption" color="text.secondary">
              {formatRelativeTime(event.createdAt)}
            </Typography>
            {showActions && <ApprovalButtons event={event} onResolved={onResolved} />}
          </Stack>
        </Box>
      </Stack>
    </Card>
  );
};

export default HermesEventCard;
