// Top application bar: sidebar toggle, workspace switcher placeholder,
// theme toggle, notifications bell, and user menu.
import React, { useState } from 'react';
import {
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import {
  toggleTheme,
  toggleSidebar,
  toggleMobileSidebar,
} from '../../state/slices/uiSlice.js';
import { logout } from '../../state/slices/authSlice.js';

export const TopBar: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const dispatch = useAppDispatch();
  const themeMode = useAppSelector((state) => state.ui.themeMode);
  const workspaceName = useAppSelector((state) => state.workspace.name);
  const user = useAppSelector((state) => state.auth.user);

  const [userAnchor, setUserAnchor] = useState<null | HTMLElement>(null);

  const handleSidebarToggle = () => {
    dispatch(isMobile ? toggleMobileSidebar() : toggleSidebar());
  };

  const userLabel = user?.email ?? 'Account';
  const avatarLetter = (user?.email ?? 'U').charAt(0).toUpperCase();

  return (
    <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
      <Toolbar sx={{ gap: 1 }}>
        <IconButton edge="start" onClick={handleSidebarToggle} aria-label="Toggle navigation">
          <MenuIcon />
        </IconButton>

        <Button
          color="inherit"
          endIcon={<UnfoldMoreIcon />}
          sx={{ textTransform: 'none', fontWeight: 600, maxWidth: 240 }}
          title="Workspace switcher (coming soon)"
        >
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
            {workspaceName || 'Select workspace'}
          </Typography>
        </Button>

        <Box sx={{ flexGrow: 1 }} />

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

        <Tooltip title={userLabel}>
          <IconButton
            onClick={(e) => setUserAnchor(e.currentTarget)}
            aria-label="Account menu"
            sx={{ ml: 0.5 }}
          >
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
              {avatarLetter}
            </Avatar>
          </IconButton>
        </Tooltip>

        <Menu
          anchorEl={userAnchor}
          open={Boolean(userAnchor)}
          onClose={() => setUserAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem disabled sx={{ opacity: '1 !important' }}>
            <Typography variant="body2" noWrap>
              {userLabel}
            </Typography>
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => setUserAnchor(null)}>
            <ListItemIcon>
              <PersonIcon fontSize="small" />
            </ListItemIcon>
            Profile
          </MenuItem>
          <MenuItem
            onClick={() => {
              setUserAnchor(null);
              dispatch(logout());
            }}
          >
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            Sign out
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
};

export default TopBar;
