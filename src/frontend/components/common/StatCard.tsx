// KPI tile: label, big value, optional trend delta (green up / red down) and icon.
// Matches the dashboard/analytics stat row in the reference design.
import React from 'react';
import { Box, Card, Skeleton, Stack, Typography } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  // Percentage change vs previous period (e.g. 12.4 or -3.1).
  deltaPct?: number;
  deltaLabel?: string;
  loading?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  deltaPct,
  deltaLabel = 'vs last month',
  loading = false,
}) => {
  const hasDelta = typeof deltaPct === 'number' && Number.isFinite(deltaPct);
  const positive = hasDelta && deltaPct >= 0;
  const deltaColor = positive ? 'success.main' : 'error.main';

  return (
    <Card sx={{ p: 2.5, height: '100%' }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        {icon && <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>}
      </Stack>

      {loading ? (
        <Skeleton variant="text" width="70%" height={44} sx={{ mt: 1 }} />
      ) : (
        <Typography variant="h3" sx={{ mt: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {value}
        </Typography>
      )}

      {loading ? (
        <Skeleton variant="text" width="45%" height={20} sx={{ mt: 0.5 }} />
      ) : (
        hasDelta && (
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.75 }}>
            {positive ? (
              <ArrowUpwardIcon sx={{ fontSize: 16, color: deltaColor }} />
            ) : (
              <ArrowDownwardIcon sx={{ fontSize: 16, color: deltaColor }} />
            )}
            <Typography variant="body2" sx={{ color: deltaColor, fontWeight: 700 }}>
              {positive ? '+' : ''}
              {deltaPct.toFixed(1)}%
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {deltaLabel}
            </Typography>
          </Stack>
        )
      )}
    </Card>
  );
};

export default StatCard;
