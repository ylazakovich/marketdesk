// Contextual application bar: route identity, global search, theme, honest
// notification availability, mobile navigation, and the primary creation action.
import React, { useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
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
import { TOPBAR_HEIGHT } from '../../utils/constants.js';

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
  if (/^\/products\/[^/]+$/.test(pathname)) {
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
  const route = resolveTopBarRoute(location.pathname);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (location.pathname === '/products') {
      setSearch(new URLSearchParams(location.search).get('search') ?? '');
    }
  }, [location.pathname, location.search]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    navigate(query ? `/products?search=${encodeURIComponent(query)}` : '/products');
  };

  return (
    <AppBar position="sticky" sx={{ top: 0, zIndex: (theme) => theme.zIndex.appBar }}>
      <Toolbar sx={{ minHeight: TOPBAR_HEIGHT, gap: { xs: 1, md: 2 }, px: { xs: 1.5, md: 3 } }}>
        <IconButton
          edge="start"
          onClick={() => dispatch(toggleMobileSidebar())}
          aria-label="Open navigation"
          sx={{ display: { md: 'none' } }}
        >
          <MenuIcon />
        </IconButton>

        <Box sx={{ minWidth: 0, flexShrink: 1 }}>
          <Typography
            variant="h1"
            noWrap
            sx={{ fontSize: { xs: '1.15rem', md: '1.35rem' }, lineHeight: 1.2 }}
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

        <Box
          component="form"
          role="search"
          onSubmit={handleSearch}
          sx={{ display: { xs: 'none', lg: 'block' }, width: 'min(340px, 28vw)' }}
        >
          <TextField
            fullWidth
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products, listings, events…"
            inputProps={{ 'aria-label': 'Global search' }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

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
  );
};

export default TopBar;
