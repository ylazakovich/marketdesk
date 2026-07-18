// Canonical MarketDesk navigation: mobile drawer, automatic medium rail, and
// user-collapsible wide desktop sidebar with an edge-straddling affordance.
import React from 'react';
import {
  Avatar,
  Badge,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import LogoutIcon from '@mui/icons-material/Logout';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import { useGetHermesEventsQuery } from '../../state/api/index.js';
import { setMobileSidebarOpen, toggleSidebar } from '../../state/slices/uiSlice.js';
import { logout } from '../../state/slices/authSlice.js';
import {
  NAV_ITEMS,
  SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  TOPBAR_HEIGHT,
  APP_NAME,
} from '../../utils/constants.js';

export type SidebarResponsiveMode = 'mobile' | 'medium' | 'desktop';

export function resolveSidebarResponsiveMode(width: number): SidebarResponsiveMode {
  if (width < 768) return 'mobile';
  if (width < 1200) return 'medium';
  return 'desktop';
}

export function isPrimaryNavActive(current: string, target: string): boolean {
  if (target === '/') return current === '/';
  return current === target || current.startsWith(`${target}/`);
}

export const Sidebar: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery('(max-width:767.95px)');
  const isMedium = useMediaQuery('(min-width:768px) and (max-width:1199.95px)');
  const collapsed = useAppSelector((state) => state.ui.sidebarCollapsed);
  const mobileOpen = useAppSelector((state) => state.ui.sidebarMobileOpen);
  const workspaceName = useAppSelector((state) => state.workspace.name);
  const user = useAppSelector((state) => state.auth.user);
  const pendingReviews = useGetHermesEventsQuery({
    status: ['pending_review'],
    limit: 1,
    offset: 0,
  });
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [accountMenuAnchor, setAccountMenuAnchor] = React.useState<HTMLElement | null>(null);

  const showLabels = isMobile || (!isMedium && !collapsed);
  const width = showLabels ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH;
  const primaryItems = NAV_ITEMS.filter((item) => item.path !== '/settings');
  const settingsItem = NAV_ITEMS.find((item) => item.path === '/settings');
  const userLabel = user?.email ?? 'Account';
  const avatarLetter = (user?.email ?? workspaceName ?? 'U').charAt(0).toUpperCase();
  const pendingReviewCount = pendingReviews.currentData?.total;

  const handleNavigate = (path: string) => {
    navigate(path);
    if (isMobile) dispatch(setMobileSidebarOpen(false));
  };

  const handleAccountMenuClose = () => setAccountMenuAnchor(null);

  const handleAccountNavigate = () => {
    handleAccountMenuClose();
    handleNavigate('/settings');
  };

  const handleSignOut = () => {
    handleAccountMenuClose();
    if (isMobile) dispatch(setMobileSidebarOpen(false));
    dispatch(logout());
  };

  const renderNavItem = (item: (typeof NAV_ITEMS)[number]) => {
    const active = isPrimaryNavActive(location.pathname, item.path);
    const isHermes = item.path === '/hermes';
    const Icon = item.icon;
    const pendingLabel =
      isHermes && pendingReviewCount
        ? `, ${pendingReviewCount} pending ${pendingReviewCount === 1 ? 'review' : 'reviews'}`
        : '';
    const button = (
      <ListItemButton
        key={item.path}
        selected={active}
        onClick={() => handleNavigate(item.path)}
        aria-label={`${item.label}${pendingLabel}`}
        sx={{
          mb: 0.5,
          minHeight: 44,
          borderRadius: 2,
          justifyContent: showLabels ? 'flex-start' : 'center',
          px: showLabels ? 1.5 : 1,
          '&.Mui-selected': {
            bgcolor: 'action.selected',
            '&:hover': { bgcolor: 'action.selected' },
          },
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
          <Badge
            color="primary"
            badgeContent={isHermes ? pendingReviewCount : undefined}
            max={99}
            invisible={!isHermes || !pendingReviewCount}
            overlap="circular"
          >
            <Icon fontSize="small" />
          </Badge>
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
      <Tooltip key={item.path} title={`${item.label}${pendingLabel}`} placement="right">
        {button}
      </Tooltip>
    );
  };

  const content = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: showLabels ? 2.5 : 2.25,
          minHeight: TOPBAR_HEIGHT,
          flexShrink: 0,
        }}
      >
        <Box
          component="img"
          src="/marketdesk-mark.svg"
          alt=""
          aria-hidden="true"
          sx={{ width: 32, height: 32, display: 'block', flexShrink: 0 }}
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
      </Box>

      <List
        component="nav"
        aria-label="Primary navigation"
        sx={{ px: showLabels ? 1.5 : 1, py: 1.5, flexGrow: 1 }}
      >
        {primaryItems.map(renderNavItem)}
      </List>

      <Stack spacing={1} sx={{ px: showLabels ? 1.5 : 1, pb: 1.5 }}>
        {settingsItem && renderNavItem(settingsItem)}
        {showLabels ? (
          <Box
            component="button"
            type="button"
            onClick={(event) => setAccountMenuAnchor(event.currentTarget)}
            aria-label={`${workspaceName || 'Workspace loading'} · ${userLabel}`}
            aria-haspopup="menu"
            aria-expanded={Boolean(accountMenuAnchor)}
            sx={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1,
              borderRadius: 2.5,
              bgcolor: 'action.hover',
              border: (t) => `1px solid ${t.palette.divider}`,
              color: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
              '&:hover': { bgcolor: 'action.selected' },
            }}
          >
            <Avatar
              sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14, flexShrink: 0 }}
            >
              {avatarLetter}
            </Avatar>
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Tooltip title={workspaceName || 'Workspace loading'} placement="top-start">
                <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                  {workspaceName || 'Workspace loading'}
                </Typography>
              </Tooltip>
              <Tooltip title={userLabel} placement="top-start">
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', lineHeight: 1.15, overflowWrap: 'anywhere' }}
                >
                  {userLabel}
                </Typography>
              </Tooltip>
            </Box>
            <KeyboardArrowDownRoundedIcon
              color="disabled"
              fontSize="small"
              sx={{ transform: accountMenuAnchor ? 'rotate(180deg)' : 'none' }}
            />
          </Box>
        ) : (
          <Tooltip title={`${workspaceName || 'Workspace'} · ${userLabel}`} placement="right">
            <ListItemButton
              onClick={(event) => setAccountMenuAnchor(event.currentTarget)}
              aria-haspopup="menu"
              aria-expanded={Boolean(accountMenuAnchor)}
              sx={{ justifyContent: 'center', px: 1 }}
            >
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
                {avatarLetter}
              </Avatar>
            </ListItemButton>
          </Tooltip>
        )}
      </Stack>
      <Menu
        anchorEl={accountMenuAnchor}
        open={Boolean(accountMenuAnchor)}
        onClose={handleAccountMenuClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <MenuItem onClick={handleAccountNavigate}>Workspace settings</MenuItem>
        <MenuItem onClick={handleSignOut}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
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
          overflow: 'visible',
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        },
      }}
      open
    >
      {content}
      {!isMedium && (
        <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
          <IconButton
            size="small"
            onClick={() => dispatch(toggleSidebar())}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            sx={{
              position: 'absolute',
              top: '50%',
              right: -15,
              transform: 'translateY(-50%)',
              width: 30,
              height: 30,
              zIndex: 1,
              border: (t) => `1px solid ${t.palette.divider}`,
              bgcolor: 'background.paper',
              color: 'text.secondary',
              boxShadow: 1,
              opacity: 0.48,
              transition: theme.transitions.create(['opacity', 'box-shadow', 'color']),
              '&:hover, &:focus-visible': {
                opacity: 1,
                color: 'primary.main',
                boxShadow: 3,
                bgcolor: 'background.paper',
              },
            }}
          >
            {collapsed ? (
              <ChevronRightRoundedIcon fontSize="small" />
            ) : (
              <ChevronLeftRoundedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      )}
    </Drawer>
  );
};

export default Sidebar;
