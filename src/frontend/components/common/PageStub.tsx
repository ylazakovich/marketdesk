// Placeholder scaffold for pages. Real pages are built in Group 9 — every use
// of this component marks an intentional, not-yet-implemented route.
import React from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import ConstructionIcon from '@mui/icons-material/Construction';

export interface PageStubProps {
  title: string;
  description?: string;
}

export const PageStub: React.FC<PageStubProps> = ({ title, description }) => (
  <Stack spacing={3}>
    <Stack direction="row" alignItems="center" spacing={1.5}>
      <Typography variant="h1" sx={{ fontSize: '1.75rem' }}>
        {title}
      </Typography>
      <Chip size="small" color="warning" variant="outlined" label="Stub · Group 9" />
    </Stack>
    <Paper
      variant="outlined"
      sx={{ p: 6, display: 'grid', placeItems: 'center', textAlign: 'center' }}
    >
      <Box sx={{ color: 'text.secondary' }}>
        <ConstructionIcon sx={{ fontSize: 48, mb: 1, opacity: 0.6 }} />
        <Typography variant="h6" sx={{ mb: 0.5 }}>
          {title} — coming soon
        </Typography>
        <Typography variant="body2">
          {description ?? 'This page is a placeholder wired for routing. Content arrives in Group 9.'}
        </Typography>
      </Box>
    </Paper>
  </Stack>
);

export default PageStub;
