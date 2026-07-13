// Sidebar navigation. Permanent (collapsible mini) on desktop, temporary
// drawer on mobile. Collapse state lives in uiSlice.
import React from 'react';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import { setMobileSidebarOpen } from '../../state/slices/uiSlice.js';
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
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  // On mobile the drawer always shows full labels; collapse only applies to desktop.
  const showLabels = isMobile || !collapsed;
  const width = showLabels ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH;

  const handleNavigate = (path: string) => {
    navigate(path);
    if (isMobile) dispatch(setMobileSidebarOpen(false));
  };

  const content = (
    <>
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
          <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
            {APP_NAME}
          </Typography>
        )}
      </Toolbar>
      <List sx={{ px: 1.5, py: 1 }}>
        {NAV_ITEMS.map((item) => {
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
        })}
      </List>
    </>
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
