import type { HermesEvent, Marketplace } from '@shared/types';
import {
  DASHBOARD_EVENT_LIMIT,
  DASHBOARD_QUICK_ACTIONS,
  DASHBOARD_SECTION_LIMIT,
  dashboardRevenueRange,
  isHermesRunActive,
  marketplaceOperationalSummary,
  marketplacePresentation,
  splitDashboardEvents,
} from './dashboardPresentation';

function marketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'marketplace-1',
    workspaceId: 'workspace-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    syncMode: 'hourly',
    errorCount: 0,
    capacity: 100,
    createdAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function event(index: number, status: HermesEvent['status'] = 'applied'): HermesEvent {
  return {
    id: `event-${index}`,
    workspaceId: 'workspace-1',
    type: 'suggested_better_title',
    severity: 'info',
    status,
    title: `Event ${index}`,
    proposedChange: null,
    createdAt: `2026-07-18T00:00:${String(index).padStart(2, '0')}.000Z`,
  };
}

describe('dashboard presentation contracts', () => {
  it('requests an inclusive 30-day daily revenue range', () => {
    expect(dashboardRevenueRange(new Date('2026-07-18T23:59:59.000Z'))).toEqual({
      from: '2026-06-19',
      to: '2026-07-18',
      interval: 'day',
    });
  });

  it('keeps quick actions truthful and routes them to existing product surfaces', () => {
    expect(DASHBOARD_QUICK_ACTIONS).toEqual([
      { key: 'add', label: 'Add product', path: '/products?newProduct=1' },
      { key: 'channels', label: 'Manage channels', path: '/marketplaces' },
      { key: 'hermes', label: 'Run Hermes', path: '/hermes' },
      { key: 'analytics', label: 'View analytics', path: '/analytics' },
    ]);
    expect(DASHBOARD_QUICK_ACTIONS.some((action) => action.label === 'Sync all')).toBe(false);
  });

  it('never presents a disconnected marketplace as connected', () => {
    expect(marketplacePresentation(marketplace({ connected: false, errorCount: 4 }))).toEqual({
      statusLabel: 'Not connected',
      statusColor: 'default',
    });
  });

  it('surfaces connected marketplace errors before a healthy state', () => {
    expect(marketplacePresentation(marketplace({ errorCount: 2 }))).toEqual({
      statusLabel: 'Needs attention',
      statusColor: 'warning',
    });
    expect(marketplacePresentation(marketplace())).toEqual({
      statusLabel: 'Connected',
      statusColor: 'success',
    });
  });

  it('does not present the synthetic marketplace capacity default as provider truth', () => {
    const summary = marketplaceOperationalSummary(marketplace({ capacity: 100, errorCount: 2 }));

    expect(summary).toBe('hourly sync · 2 errors');
    expect(summary).not.toContain('100');
    expect(summary).not.toContain('capacity');
  });

  it('shows an active Hermes indicator only for actual in-flight lifecycle states', () => {
    expect(isHermesRunActive([event(1, 'pending_review'), event(2, 'applied')])).toBe(false);
    expect(isHermesRunActive([event(1, 'applying')])).toBe(true);
    expect(isHermesRunActive([event(1, 'reverting')])).toBe(true);
  });

  it('bounds the dashboard card and timeline without reordering server results', () => {
    const events = Array.from({ length: 12 }, (_, index) => event(index));
    const result = splitDashboardEvents(events);

    expect(result.latest).toHaveLength(DASHBOARD_SECTION_LIMIT);
    expect(result.timeline).toHaveLength(DASHBOARD_EVENT_LIMIT);
    expect(result.latest.map((item) => item.id)).toEqual([
      'event-0',
      'event-1',
      'event-2',
      'event-3',
    ]);
    expect(result.timeline.at(-1)?.id).toBe('event-7');
  });
});
