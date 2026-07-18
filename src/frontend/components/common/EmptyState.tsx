// Empty-state placeholder: icon, title, description, optional action.
import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import InboxIcon from '@mui/icons-material/Inbox';

export interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
  compact = false,
}) => (
  <Box
    sx={{
      display: 'grid',
      placeItems: 'center',
      textAlign: 'center',
      py: compact ? 4 : 8,
      px: 2,
    }}
  >
    <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
      <Box sx={{ color: 'text.disabled', display: 'flex' }}>
        {icon ?? <InboxIcon sx={{ fontSize: compact ? 36 : 48 }} />}
      </Box>
      <Typography variant="h6">{title}</Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Stack>
  </Box>
);

export default EmptyState;
