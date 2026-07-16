// Frontend UI constants (navigation, layout dimensions).
// Domain constants live in @shared/constants — reuse those, don't duplicate.
import type { SvgIconComponent } from '@mui/icons-material';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import InventoryIcon from '@mui/icons-material/Inventory2';
import InsightsIcon from '@mui/icons-material/Insights';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import HubIcon from '@mui/icons-material/Hub';
import SettingsIcon from '@mui/icons-material/Settings';

export interface NavItem {
  label: string;
  path: string;
  icon: SvgIconComponent;
}

// Order matches PRD §4. Listings remain routable for deep links but are managed
// contextually under Products rather than occupying a second primary destination.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/', icon: DashboardIcon },
  { label: 'Products', path: '/products', icon: InventoryIcon },
  { label: 'Analytics', path: '/analytics', icon: InsightsIcon },
  { label: 'Hermes AI', path: '/hermes', icon: AutoAwesomeIcon },
  { label: 'Marketplaces', path: '/marketplaces', icon: HubIcon },
  { label: 'Settings', path: '/settings', icon: SettingsIcon },
];

export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 76;
export const TOPBAR_HEIGHT = 64;

export const APP_NAME = 'MarketDesk';
