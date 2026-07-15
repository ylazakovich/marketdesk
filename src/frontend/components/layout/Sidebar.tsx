// Sidebar navigation. Permanent (collapsible mini) on desktop, temporary
// drawer on mobile. Settings and account controls stay pinned at the bottom.
import React from 'react';
import {
  Avatar,
  Box,
  Button,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import LogoutIcon from '@mui/icons-material/Logout';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import { setMobileSidebarOpen } from '../../state/slices/uiSlice.js';
import { logout } from '../../state/slices/authSlice.js';
import {
  NAV_ITEMS,
  SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  APP_NAME,
} from '../../utils/constants.js';

function isActivePath(current: string, target: string): boolean {
  if (target === '/') return current === '/';
  return current === target || current.startsWith(`${target}/`);
}

export const Sidebar: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const collapsed = useAppSelector((state) => state.ui.sidebarCollapsed);
  const mobileOpen = useAppSelector((state) => state.ui.sidebarMobileOpen);
  const workspaceName = useAppSelector((state) => state.workspace.name);
  const user = useAppSelector((state) => state.auth.user);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  // On mobile the drawer always shows full labels; collapse only applies to desktop.
  const showLabels = isMobile || !collapsed;
  const width = showLabels ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH;
  const primaryItems = NAV_ITEMS.filter((item) => item.path !== '/settings');
  const settingsItem = NAV_ITEMS.find((item) => item.path === '/settings');
  const userLabel = user?.email ?? 'Account';
  const avatarLetter = (user?.email ?? 'U').charAt(0).toUpperCase();

  const handleNavigate = (path: string) => {
    navigate(path);
    if (isMobile) dispatch(setMobileSidebarOpen(false));
  };

  const renderNavItem = (item: (typeof NAV_ITEMS)[number]) => {
    const active = isActivePath(location.pathname, item.path);
    const Icon = item.icon;
    const button = (
      <ListItemButton
        key={item.path}
        selected={active}
        onClick={() => handleNavigate(item.path)}
        sx={{
          mb: 0.5,
          minHeight: 44,
          justifyContent: showLabels ? 'flex-start' : 'center',
          px: showLabels ? 1.5 : 1,
        }}
      >
        <ListItemIcon
          sx={{
            minWidth: 0,
            mr: showLabels ? 2 : 0,
            justifyContent: 'center',
            color: active ? 'primary.main' : 'text.secondary',
          }}
        >
          <Icon fontSize="small" />
        </ListItemIcon>
        {showLabels && (
          <ListItemText
            primary={item.label}
            slotProps={{
              primary: { variant: 'body2', sx: { fontWeight: active ? 700 : 500 } },
            }}
          />
        )}
      </ListItemButton>
    );
    return showLabels ? (
      button
    ) : (
      <Tooltip key={item.path} title={item.label} placement="right">
        {button}
      </Tooltip>
    );
  };

  const content = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar sx={{ px: 2.5, gap: 1.25, minHeight: 64 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 2,
            display: 'grid',
            placeItems: 'center',
            color: 'primary.contrastText',
            background: (t) =>
              `linear-gradient(135deg, ${t.palette.primary.light}, ${t.palette.primary.dark})`,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          M
        </Box>
        {showLabels && (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" noWrap sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              {APP_NAME}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {workspaceName || 'Workspace loading'}
            </Typography>
          </Box>
        )}
      </Toolbar>

      <List sx={{ px: 1.5, py: 1, flexGrow: 1 }}>
        {primaryItems.map(renderNavItem)}
      </List>

      <Stack spacing={1} sx={{ px: 1.5, pb: 1.5 }}>
        {settingsItem && renderNavItem(settingsItem)}
        {showLabels ? (
          <Box
            sx={{
              p: 1.25,
              borderRadius: 2.5,
              bgcolor: 'action.hover',
              border: (t) => `1px solid ${t.palette.divider}`,
            }}
          >
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1 }}>
              <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14 }}>
                {avatarLetter}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                  {workspaceName || 'Workspace'}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {userLabel}
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" onClick={() => handleNavigate('/settings')} sx={{ flex: 1, textTransform: 'none' }}>
                Profile
              </Button>
              <Tooltip title="Sign out">
                <Button size="small" variant="text" color="inherit" onClick={() => dispatch(logout())} aria-label="Sign out">
                  <LogoutIcon fontSize="small" />
                </Button>
              </Tooltip>
            </Stack>
          </Box>
        ) : (
          <Tooltip title={userLabel} placement="right">
            <ListItemButton onClick={() => handleNavigate('/settings')} sx={{ justifyContent: 'center', px: 1 }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
                {avatarLetter}
              </Avatar>
            </ListItemButton>
          </Tooltip>
        )}
      </Stack>
    </Box>
  );

  if (isMobile) {
    return (
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => dispatch(setMobileSidebarOpen(false))}
        ModalProps={{ keepMounted: true }}
        sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' } }}
      >
        {content}
      </Drawer>
    );
  }

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        transition: theme.transitions.create('width', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          overflowX: 'hidden',
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        },
      }}
      open
    >
      {content}
    </Drawer>
  );
};

export default Sidebar;
