// Frontend UI constants (navigation, layout dimensions).
// Domain constants live in @shared/constants — reuse those, don't duplicate.
import type { SvgIconComponent } from '@mui/icons-material';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import InventoryIcon from '@mui/icons-material/Inventory2';
import StorefrontIcon from '@mui/icons-material/Storefront';
import InsightsIcon from '@mui/icons-material/Insights';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import HubIcon from '@mui/icons-material/Hub';
import SettingsIcon from '@mui/icons-material/Settings';

export interface NavItem {
  label: string;
  path: string;
  icon: SvgIconComponent;
}

// Order matches the sidebar. Paths map 1:1 to the routes wired in App.tsx.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/', icon: DashboardIcon },
  { label: 'Products', path: '/products', icon: InventoryIcon },
  { label: 'Listings', path: '/listings', icon: StorefrontIcon },
  { label: 'Analytics', path: '/analytics', icon: InsightsIcon },
  { label: 'Hermes', path: '/hermes', icon: AutoAwesomeIcon },
  { label: 'Marketplaces', path: '/marketplaces', icon: HubIcon },
  { label: 'Settings', path: '/settings', icon: SettingsIcon },
];

export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 76;
export const TOPBAR_HEIGHT = 64;

export const APP_NAME = 'MarketDesk';
