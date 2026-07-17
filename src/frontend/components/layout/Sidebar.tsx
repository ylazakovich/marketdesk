// Sidebar navigation. Permanent and collapsible on desktop, temporary on mobile.
// Brand identity, Settings, workspace/account, and sign-out stay in stable locations.
import React from 'react';
import {
  Avatar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuOpenRoundedIcon from '@mui/icons-material/MenuOpenRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import LogoutIcon from '@mui/icons-material/Logout';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import { setMobileSidebarOpen, toggleSidebar } from '../../state/slices/uiSlice.js';
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

  const showLabels = isMobile || !collapsed;
  const width = showLabels ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH;
  const primaryItems = NAV_ITEMS.filter((item) => item.path !== '/settings');
  const settingsItem = NAV_ITEMS.find((item) => item.path === '/settings');
  const userLabel = user?.email ?? 'Account';
  const avatarLetter = (user?.email ?? workspaceName ?? 'U').charAt(0).toUpperCase();

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
            slotProps={{ primary: { variant: 'body2', sx: { fontWeight: active ? 700 : 500 } } }}
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
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.25}
        sx={{ px: showLabels ? 2 : 1.5, minHeight: 72 }}
      >
        <Box
          component="img"
          src="/marketdesk-mark.svg"
          alt=""
          aria-hidden="true"
          sx={{
            width: 36,
            height: 36,
            display: 'block',
            flexShrink: 0,
          }}
        />
        {showLabels && (
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography
              variant="overline"
              color="primary.main"
              noWrap
              sx={{
                display: 'block',
                fontSize: 9,
                lineHeight: 1.1,
                fontWeight: 800,
                letterSpacing: 1.2,
              }}
            >
              Marketplace OS
            </Typography>
            <Typography variant="h6" noWrap sx={{ fontWeight: 800, lineHeight: 1.25 }}>
              {APP_NAME}
            </Typography>
          </Box>
        )}
        {!isMobile && (
          <Tooltip title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
            <IconButton
              size="small"
              onClick={() => dispatch(toggleSidebar())}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              sx={{ ml: showLabels ? 0 : 'auto' }}
            >
              {collapsed ? <ChevronRightRoundedIcon /> : <MenuOpenRoundedIcon />}
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      <List component="nav" aria-label="Primary navigation" sx={{ px: 1.5, py: 1, flexGrow: 1 }}>
        {primaryItems.map(renderNavItem)}
      </List>

      <Stack spacing={1} sx={{ px: 1.5, pb: 1.5 }}>
        {settingsItem && renderNavItem(settingsItem)}
        {showLabels ? (
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{
              p: 1,
              borderRadius: 2.5,
              bgcolor: 'action.hover',
              border: (t) => `1px solid ${t.palette.divider}`,
            }}
          >
            <Avatar
              sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14, flexShrink: 0 }}
            >
              {avatarLetter}
            </Avatar>
            <Box
              component="button"
              type="button"
              onClick={() => handleNavigate('/settings')}
              sx={{
                minWidth: 0,
                flexGrow: 1,
                p: 0,
                border: 0,
                bgcolor: 'transparent',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <Tooltip title={workspaceName || 'Workspace loading'} placement="top-start">
                <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                  {workspaceName || 'Workspace loading'}
                </Typography>
              </Tooltip>
              <Tooltip title={userLabel} placement="top-start">
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: 'block' }}
                >
                  {userLabel}
                </Typography>
              </Tooltip>
            </Box>
            <KeyboardArrowDownRoundedIcon color="disabled" fontSize="small" />
            <Tooltip title="Sign out">
              <IconButton
                size="small"
                onClick={() => {
                  if (isMobile) dispatch(setMobileSidebarOpen(false));
                  dispatch(logout());
                }}
                aria-label="Sign out"
              >
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : (
          <>
            <Tooltip title={`${workspaceName || 'Workspace'} · ${userLabel}`} placement="right">
              <ListItemButton
                onClick={() => handleNavigate('/settings')}
                sx={{ justifyContent: 'center', px: 1 }}
              >
                <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
                  {avatarLetter}
                </Avatar>
              </ListItemButton>
            </Tooltip>
            <Tooltip title="Sign out" placement="right">
              <IconButton
                size="small"
                onClick={() => dispatch(logout())}
                aria-label="Sign out"
                sx={{ alignSelf: 'center' }}
              >
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
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
          position: 'sticky',
          top: 0,
          height: '100vh',
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
