import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HermesEvent } from '@shared/types';
import HermesActivityPage, { HERMES_SETTINGS_PATH, HermesHero, HermesMetrics } from './HermesActivityPage';

const event: HermesEvent = {
  id: 'event-1',
  workspaceId: 'workspace-1',
  productId: 'product-1',
  type: 'suggested_lower_price',
  severity: 'warning',
  status: 'pending_review',
  title: 'Review price',
  detail: 'A recorded suggestion.',
  proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
  createdAt: '2026-07-18T12:00:00.000Z',
};

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock('../state/hooks.js', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: () => 'PLN',
}));

jest.mock('../services/hooks/index.js', () => ({
  useHermesEvents: () => ({
    data: { items: [event], total: 7, limit: 50, offset: 0 },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: undefined,
    refetch: jest.fn(),
  }),
  useApproveHermesEvent: () => [jest.fn(), { isLoading: false }],
  useDismissHermesEvent: () => [jest.fn(), { isLoading: false }],
  useExecuteCategoryRecreationOperation: () => [jest.fn(), { isLoading: false }],
}));

describe('HermesActivityPage dashboard', () => {
  it('renders the hero, real Configure deep link contract, tabs, and compact filters', () => {
    const html = renderToStaticMarkup(<HermesActivityPage />);

    expect(HERMES_SETTINGS_PATH).toBe('/settings#hermes');
    expect(html).toContain('Hermes AI agent');
    expect(html).toContain('Configure');
    expect(html).toContain('Select product to analyze');
    expect(html).toContain('Whole-catalogue runs are not started from the UI');
    expect(html).toContain('All activity');
    expect(html).toContain('Suggestions');
    expect(html).toContain('Alerts');
    expect(html).toContain('Completed');
    expect(html).toContain('All statuses');
    expect(html).toContain('All severities');
  });

  it('routes analysis initiation to product selection instead of a global run', () => {
    const html = renderToStaticMarkup(
      <HermesHero onConfigure={jest.fn()} onSelectProduct={jest.fn()} />
    );

    expect(html).toContain('New analysis starts from one explicitly selected product');
    expect(html).toContain('Analyze with Hermes');
    expect(html).not.toContain('Run Hermes');
  });

  it('uses an authoritative pending-review total and marks unsupported metrics unavailable', () => {
    const html = renderToStaticMarkup(<HermesMetrics awaitingReview={7} />);

    expect(html).toContain('Actions today');
    expect(html).toContain('Awaiting review');
    expect(html).toContain('Listings created');
    expect(html).toContain('Time saved');
    expect(html).toContain('>7<');
    expect(html.match(/Unavailable/g) ?? []).toHaveLength(3);
    expect(html).not.toContain('Estimated');
  });
});
