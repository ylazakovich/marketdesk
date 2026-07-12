// Error state with a retry action. Accepts an RTK Query error (or anything) and
// renders a friendly message; onRetry typically calls the query's refetch().
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';

export interface ErrorRetryProps {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
  compact?: boolean;
}

function extractMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    // fetchBaseQuery error shape: { status, data: { error: { message } } }
    const data = e.data as { error?: { message?: string }; message?: string } | undefined;
    if (data?.error?.message) return data.error.message;
    if (data?.message) return data.message;
    if (typeof e.error === 'string') return e.error;
    if (typeof e.message === 'string') return e.message;
    if (e.status !== undefined) return `Request failed (${String(e.status)}).`;
  }
  return undefined;
}

export const ErrorRetry: React.FC<ErrorRetryProps> = ({
  error,
  title = 'Something went wrong',
  onRetry,
  compact = false,
}) => {
  const detail = extractMessage(error);
  return (
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        py: compact ? 4 : 8,
        px: 2,
      }}
    >
      <Stack spacing={1.5} alignItems="center">
        <ErrorOutlineIcon sx={{ fontSize: compact ? 36 : 48, color: 'error.main', opacity: 0.9 }} />
        <Typography variant="h6">{title}</Typography>
        {detail && (
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
            {detail}
          </Typography>
        )}
        {onRetry && (
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
            Try again
          </Button>
        )}
      </Stack>
    </Box>
  );
};

export default ErrorRetry;
