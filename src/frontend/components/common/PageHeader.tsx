// Consistent page header: title + optional subtitle and a right-aligned action slot.
import React from 'react';
import { Box, Stack, Typography } from '@mui/material';

export interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions }) => (
  <Stack
    direction={{ xs: 'column', sm: 'row' }}
    alignItems={{ xs: 'flex-start', sm: 'center' }}
    justifyContent="space-between"
    spacing={2}
    sx={{ mb: 3 }}
  >
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="h1" sx={{ fontSize: '1.75rem' }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {subtitle}
        </Typography>
      )}
    </Box>
    {actions && <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
  </Stack>
);

export default PageHeader;
