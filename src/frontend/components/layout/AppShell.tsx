// Overall app layout: persistent sidebar, contextual top bar, and scrollable content outlet.
// Rendered as a React Router layout route (see App.tsx).
import React, { Suspense } from 'react';
import { Box } from '@mui/material';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar.js';
import { Sidebar } from './Sidebar.js';
import { PageSkeleton } from '../common/Skeleton.js';
import { APP_SHELL_CONTENT_INSET } from '../../utils/constants.js';

export const AppShell: React.FC = () => (
  <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
    <Sidebar />
    <Box
      component="main"
      sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
    >
      <TopBar />
      <Box
        sx={{
          flexGrow: 1,
          width: '100%',
          maxWidth: 1600,
          mx: 'auto',
          p: { xs: 2, md: `${APP_SHELL_CONTENT_INSET}px` },
        }}
      >
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </Box>
    </Box>
  </Box>
);

export default AppShell;
