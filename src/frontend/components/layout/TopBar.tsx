// Contextual 64px application bar: route identity, global command palette,
// theme, honest notification availability, mobile navigation, and creation.
import React, { useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import { toggleTheme, toggleMobileSidebar } from '../../state/slices/uiSlice.js';
import { APP_SHELL_CONTENT_INSET, TOPBAR_HEIGHT } from '../../utils/constants.js';
import { CommandPalette, isCommandPaletteShortcut } from './CommandPalette.js';

export interface TopBarRouteMeta {
  title: string;
  subtitle: string;
}

const ROUTE_META: Record<string, TopBarRouteMeta> = {
  '/': {
    title: 'Dashboard',
    subtitle: 'Monitor products, marketplaces, and Hermes work from one command center.',
  },
  '/products': {
    title: 'Products',
    subtitle: 'Manage your catalogue across every marketplace.',
  },
  '/listings': {
    title: 'Listings',
    subtitle: 'Every live and draft listing across connected marketplaces.',
  },
  '/analytics': {
    title: 'Analytics',
    subtitle: 'Performance across marketplaces.',
  },
  '/hermes': {
    title: 'Hermes AI',
    subtitle: 'Everything your AI agent did across monitored listings.',
  },
  '/marketplaces': {
    title: 'Marketplaces',
    subtitle: 'Connect and synchronize sales channels.',
  },
  '/settings': {
    title: 'Settings',
    subtitle: 'Workspace and account preferences.',
  },
};

export function resolveTopBarRoute(pathname: string): TopBarRouteMeta {
  if (pathname === '/products/new' || pathname.startsWith('/products/new/')) {
    return {
      title: 'New product',
      subtitle: 'Create a product and prepare marketplace listings.',
    };
  }
  if (pathname.startsWith('/products/')) {
    return {
      title: 'Product detail',
      subtitle: 'Listing status, pricing, and marketplace activity.',
    };
  }
  return (
    ROUTE_META[pathname] ?? {
      title: 'MarketDesk',
      subtitle: 'Marketplace operations workspace.',
    }
  );
}

export const TopBar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const themeMode = useAppSelector((state) => state.ui.themeMode);
  const isMobile = useMediaQuery('(max-width:767.95px)');
  const route = resolveTopBarRoute(location.pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!isCommandPaletteShortcut(event)) return;
      event.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  return (
    <>
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{
          top: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          bgcolor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(18, 18, 24, 0.9)' : 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(14px)',
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        }}
      >
        <Toolbar
          disableGutters
          sx={{
            minHeight: `${TOPBAR_HEIGHT}px !important`,
            height: TOPBAR_HEIGHT,
            gap: { xs: 1, sm: 1.5, lg: 2 },
            px: { xs: 2, md: `${APP_SHELL_CONTENT_INSET}px` },
          }}
        >
          {isMobile && (
            <IconButton
              edge="start"
              onClick={() => dispatch(toggleMobileSidebar())}
              aria-label="Open navigation drawer"
            >
              <MenuIcon />
            </IconButton>
          )}

          <Box sx={{ minWidth: 0, flexShrink: 1 }}>
            <Typography
              variant="h1"
              noWrap
              sx={{ fontSize: { xs: '1.1rem', md: '1.3rem' }, lineHeight: 1.18, fontWeight: 800 }}
            >
              {route.title}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ display: { xs: 'none', sm: 'block' }, maxWidth: { sm: 260, lg: 430 } }}
            >
              {route.subtitle}
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          <Button
            variant="outlined"
            color="inherit"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search products, listings, and Hermes events"
            sx={{
              display: { xs: 'none', md: 'inline-flex' },
              width: { md: 210, lg: 320 },
              minWidth: 0,
              height: 38,
              justifyContent: 'flex-start',
              color: 'text.secondary',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              px: 1.25,
              textTransform: 'none',
              '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
            }}
          >
            <SearchIcon fontSize="small" />
            <Typography variant="body2" noWrap sx={{ ml: 1, flexGrow: 1, textAlign: 'left' }}>
              Search products, listings, events…
            </Typography>
            <Box
              component="kbd"
              sx={{
                ml: 1,
                px: 0.75,
                py: 0.15,
                border: (theme) => `1px solid ${theme.palette.divider}`,
                borderRadius: 1,
                bgcolor: 'action.hover',
                color: 'text.secondary',
                fontFamily: 'inherit',
                fontSize: 11,
                whiteSpace: 'nowrap',
              }}
            >
              ⌘/Ctrl K
            </Box>
          </Button>
          <Tooltip title="Global search (⌘/Ctrl+K)">
            <IconButton
              onClick={() => setPaletteOpen(true)}
              aria-label="Open global search"
              sx={{ display: { xs: 'inline-flex', md: 'none' } }}
            >
              <SearchIcon />
            </IconButton>
          </Tooltip>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Tooltip title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              <IconButton onClick={() => dispatch(toggleTheme())} aria-label="Toggle theme">
                {themeMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>

            <Tooltip title="Notifications are not available yet">
              <span>
                <IconButton disabled aria-label="Notifications unavailable">
                  <NotificationsNoneIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/products?newProduct=1')}
            sx={{ display: { xs: 'none', sm: 'inline-flex' }, whiteSpace: 'nowrap' }}
          >
            New product
          </Button>
          <Tooltip title="New product">
            <IconButton
              color="primary"
              onClick={() => navigate('/products?newProduct=1')}
              aria-label="New product"
              sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
            >
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
};

export default TopBar;
