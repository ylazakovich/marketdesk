import type { HermesEvent, Marketplace } from '@shared/types';
import type { AnalyticsQueryParams } from '../state/api/index.js';

export const DASHBOARD_EVENT_LIMIT = 8;
export const DASHBOARD_SECTION_LIMIT = 4;

const ACTIVE_HERMES_STATUSES = new Set<HermesEvent['status']>(['applying', 'reverting']);

export const DASHBOARD_QUICK_ACTIONS = [
  { key: 'add', label: 'Add product', path: '/products?newProduct=1' },
  { key: 'channels', label: 'Manage channels', path: '/marketplaces' },
  { key: 'hermes', label: 'Run Hermes', path: '/hermes' },
  { key: 'analytics', label: 'View analytics', path: '/analytics' },
] as const;

export function dashboardRevenueRange(now = new Date()): AnalyticsQueryParams {
  const to = new Date(now);
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    interval: 'day',
  };
}

export interface MarketplacePresentation {
  statusLabel: 'Connected' | 'Needs attention' | 'Not connected';
  statusColor: 'success' | 'warning' | 'default';
}

export function marketplacePresentation(marketplace: Marketplace): MarketplacePresentation {
  if (!marketplace.connected) return { statusLabel: 'Not connected', statusColor: 'default' };
  if (marketplace.errorCount > 0) {
    return { statusLabel: 'Needs attention', statusColor: 'warning' };
  }
  return { statusLabel: 'Connected', statusColor: 'success' };
}

export function marketplaceOperationalSummary(marketplace: Marketplace): string {
  const segments = [`${marketplace.syncMode} sync`];
  if (marketplace.errorCount > 0) segments.push(`${marketplace.errorCount} errors`);
  return segments.join(' · ');
}

export function isHermesRunActive(events: readonly HermesEvent[]): boolean {
  return events.some((event) => ACTIVE_HERMES_STATUSES.has(event.status));
}

export function splitDashboardEvents(events: readonly HermesEvent[]): {
  latest: HermesEvent[];
  timeline: HermesEvent[];
} {
  return {
    latest: events.slice(0, DASHBOARD_SECTION_LIMIT),
    timeline: events.slice(0, DASHBOARD_EVENT_LIMIT),
  };
}
