import React from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { HermesEvent } from '@shared/types';
import { Card } from '../common/Card.js';
import { HermesEventCard } from './HermesEventCard.js';
import {
  isSeoRecommendation,
  recommendationFieldLabel,
} from '../../utils/labels.js';

export const SEO_RECOMMENDATION_PREVIEW_LIMIT = 3;

export { isSeoRecommendation, recommendationFieldLabel } from '../../utils/labels.js';

export const SeoLegendChip: React.FC = () => (
  <Tooltip title="SEO · listing search optimization" arrow>
    <Chip
      size="small"
      label="SEO"
      aria-label="SEO, listing search optimization"
      color="primary"
      variant="outlined"
      sx={{ fontWeight: 900, letterSpacing: '0.05em' }}
    />
  </Tooltip>
);

export interface SeoRecommendationQueueProps {
  events: HermesEvent[];
  total: number;
  onResolved?: () => void;
  onViewAll: () => void;
  approveLabel?: string;
  successMessage?: (event: HermesEvent) => string | undefined;
}

export const SeoRecommendationQueue: React.FC<SeoRecommendationQueueProps> = ({
  events,
  total,
  onResolved,
  onViewAll,
  approveLabel,
  successMessage,
}) => {
  const [selectedId, setSelectedId] = React.useState(events[0]?.id ?? '');
  const selected = events.find((event) => event.id === selectedId) ?? events[0];

  React.useEffect(() => {
    if (!events.some((event) => event.id === selectedId)) setSelectedId(events[0]?.id ?? '');
  }, [events, selectedId]);

  if (!selected) return null;

  const remaining = events.filter((event) => event.id !== selected.id);
  const preview = remaining.slice(0, SEO_RECOMMENDATION_PREVIEW_LIMIT);
  const hiddenCount = Math.max(total - 1 - preview.length, 0);

  return (
    <Stack spacing={1.25} data-testid="seo-recommendation-queue">
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
          Hermes review queue · one suggestion expanded
        </Typography>
      </Stack>

      <HermesEventCard
        event={selected}
        variant={isSeoRecommendation(selected) ? 'compactReview' : 'default'}
        onResolved={onResolved}
        approveLabel={approveLabel}
        successMessage={successMessage?.(selected)}
      />

      {preview.length > 0 && (
        <Box
          component="ul"
          role="list"
          aria-label="Other pending Hermes recommendations"
          sx={{ m: 0, p: 0, listStyle: 'none', border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
        >
          {preview.map((event) => (
            <Box
              component="li"
              key={event.id}
              data-testid="recommendation-preview"
              sx={{ borderTop: '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}
            >
              <ButtonBase
                onClick={() => setSelectedId(event.id)}
                aria-label={`Review ${recommendationFieldLabel(event)} recommendation: ${event.title}`}
                sx={{
                  width: '100%',
                  gap: 1,
                  px: 1.25,
                  py: 1,
                  textAlign: 'left',
                  justifyContent: 'flex-start',
                  '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
                }}
              >
                {isSeoRecommendation(event) ? <SeoLegendChip /> : (
                  <Chip size="small" label={recommendationFieldLabel(event)} variant="outlined" />
                )}
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
                    {recommendationFieldLabel(event)} · {event.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Human review required
                  </Typography>
                </Box>
                <ChevronRightIcon color="disabled" fontSize="small" />
              </ButtonBase>
            </Box>
          ))}
        </Box>
      )}

      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          {total === 1
            ? 'This is the only pending recommendation.'
            : `${total - 1} more pending${hiddenCount ? ` · ${hiddenCount} not expanded here` : ''}`}
        </Typography>
        <Button size="small" variant="text" onClick={onViewAll}>
          View all {total}
        </Button>
      </Stack>
    </Stack>
  );
};

export interface SeoReviewSummaryProps {
  event?: HermesEvent;
  total: number;
  loading?: boolean;
  error?: unknown;
  onRetry: () => void;
  onReview: (event: HermesEvent) => void;
  onViewAll: () => void;
}

export const SeoReviewSummary: React.FC<SeoReviewSummaryProps> = ({
  event,
  total,
  loading = false,
  error,
  onRetry,
  onReview,
  onViewAll,
}) => (
  <Card
    title={
      <Stack direction="row" spacing={1} alignItems="center">
        {event && isSeoRecommendation(event) ? (
          <SeoLegendChip />
        ) : event ? (
          <Chip size="small" label={recommendationFieldLabel(event)} variant="outlined" />
        ) : null}
        <span>Review queue</span>
        {!loading && !error && <Chip size="small" color="warning" label={total} />}
      </Stack>
    }
    subtitle="Highest-priority human review"
    sx={{ borderColor: 'primary.main' }}
  >
    {loading ? (
      <Typography variant="body2" role="status" color="text.secondary">Loading reviews…</Typography>
    ) : error ? (
      <Stack spacing={1}>
        <Typography variant="body2" color="error.main">Hermes review queue is unavailable.</Typography>
        <Button size="small" variant="outlined" onClick={onRetry} sx={{ alignSelf: 'flex-start' }}>Retry</Button>
      </Stack>
    ) : !event ? (
      <Typography variant="body2" color="text.secondary">No pending recommendations.</Typography>
    ) : (
      <Stack spacing={1.25}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {recommendationFieldLabel(event)}{event.productId ? ' · Product review' : ''}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>
            {event.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            No change is applied until you approve it.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button size="small" variant="contained" onClick={() => onReview(event)}>
            Review next
          </Button>
          <Button size="small" variant="text" onClick={onViewAll}>View all</Button>
        </Stack>
      </Stack>
    )}
  </Card>
);
