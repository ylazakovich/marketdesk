// Overall app layout: fixed TopBar + Sidebar + scrollable content outlet.
// Rendered as a React Router layout route (see App.tsx).
import React, { Suspense } from 'react';
import { Box, Toolbar } from '@mui/material';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar.js';
import { Sidebar } from './Sidebar.js';
import { PageSkeleton } from '../common/Skeleton.js';

export const AppShell: React.FC = () => (
  <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
    <TopBar />
    <Sidebar />
    <Box component="main" sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Spacer matching the fixed AppBar height. */}
      <Toolbar />
      <Box sx={{ flexGrow: 1, p: { xs: 2, md: 3 } }}>
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </Box>
    </Box>
  </Box>
);

export default AppShell;
