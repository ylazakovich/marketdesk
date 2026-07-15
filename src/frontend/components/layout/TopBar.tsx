// Top application bar: sidebar toggle, theme toggle, notifications bell, and
// primary creation action. Account/workspace controls live in the sidebar.
import React from 'react';
import {
  AppBar,
  Badge,
  Box,
  Button,
  IconButton,
  Toolbar,
  Tooltip,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import {
  toggleTheme,
  toggleSidebar,
  toggleMobileSidebar,
} from '../../state/slices/uiSlice.js';

export const TopBar: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const dispatch = useAppDispatch();
  const themeMode = useAppSelector((state) => state.ui.themeMode);

  const handleSidebarToggle = () => {
    dispatch(isMobile ? toggleMobileSidebar() : toggleSidebar());
  };

  return (
    <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
      <Toolbar sx={{ gap: 1 }}>
        <IconButton edge="start" onClick={handleSidebarToggle} aria-label="Toggle navigation">
          <MenuIcon />
        </IconButton>

        <Box sx={{ flexGrow: 1 }} />

        <Button
          color="inherit"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => navigate('/products?newProduct=1')}
          sx={{ display: { xs: 'none', sm: 'inline-flex' }, textTransform: 'none', fontWeight: 700 }}
        >
          New product
        </Button>
        <Tooltip title="New product">
          <IconButton
            color="inherit"
            onClick={() => navigate('/products?newProduct=1')}
            aria-label="New product"
            sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
          >
            <AddIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          <IconButton onClick={() => dispatch(toggleTheme())} aria-label="Toggle theme">
            {themeMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        </Tooltip>

        <Tooltip title="Notifications">
          <IconButton aria-label="Notifications">
            <Badge color="error" variant="dot">
              <NotificationsNoneIcon />
            </Badge>
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
};

export default TopBar;
