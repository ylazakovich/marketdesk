// Shared chart states + theming helpers so every chart handles
// loading / error / empty consistently and picks up the MUI palette.
import React from 'react';
import { Box, Skeleton } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { EmptyState } from '../common/EmptyState.js';

export interface ChartStateProps {
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  height?: number;
  children: React.ReactNode;
}

export function useChartColors() {
  const theme = useTheme();
  return {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
    grid: theme.palette.divider,
    axis: theme.palette.text.secondary,
    tooltipBg: theme.palette.background.paper,
    tooltipBorder: theme.palette.divider,
    text: theme.palette.text.primary,
  };
}

export const ChartState: React.FC<ChartStateProps> = ({
  loading,
  error,
  onRetry,
  isEmpty,
  emptyTitle = 'No data for this period',
  height = 300,
  children,
}) => {
  if (error) return <ErrorRetry error={error} onRetry={onRetry} compact />;
  if (loading) return <Skeleton variant="rounded" height={height} sx={{ borderRadius: 2 }} />;
  if (isEmpty) {
    return (
      <Box sx={{ height }}>
        <EmptyState title={emptyTitle} compact />
      </Box>
    );
  }
  return <Box sx={{ width: '100%', height }}>{children}</Box>;
};
