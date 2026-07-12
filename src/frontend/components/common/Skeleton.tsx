// Minimal loading primitives used by the shell (route Suspense fallback, etc.).
// The full component library (tables/forms/charts) is Group 9.
import React from 'react';
import { Box, Skeleton as MuiSkeleton } from '@mui/material';

export interface LoadingSkeletonProps {
  lines?: number;
  height?: number | string;
}

// A block of stacked text-line skeletons.
export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ lines = 4, height = 28 }) => (
  <Box sx={{ width: '100%' }}>
    {Array.from({ length: lines }).map((_, index) => (
      <MuiSkeleton
        key={index}
        variant="rounded"
        height={height}
        sx={{ mb: 1.5, borderRadius: 2 }}
        width={index === lines - 1 ? '60%' : '100%'}
      />
    ))}
  </Box>
);

// Full-page fallback for lazily-loaded routes.
export const PageSkeleton: React.FC = () => (
  <Box sx={{ p: 3 }}>
    <MuiSkeleton variant="text" width={220} height={40} sx={{ mb: 3 }} />
    <LoadingSkeleton lines={6} />
  </Box>
);

export default LoadingSkeleton;
