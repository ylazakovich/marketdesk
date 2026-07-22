import React from 'react';
import { Button, Stack, TextField, Typography } from '@mui/material';
import {
  AnalyticsDateRangeControls,
  analyticsCsv,
  analyticsRangeForPreset,
} from './AnalyticsPage';
import type { ListingPerformance } from '../state/api';

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function renderControls(overrides: Partial<React.ComponentProps<typeof AnalyticsDateRangeControls>> = {}) {
  const props: React.ComponentProps<typeof AnalyticsDateRangeControls> = {
    from: '2026-07-01', to: '2026-07-14', preset: '30d',
    onFromChange: jest.fn(), onToChange: jest.fn(), onPresetChange: jest.fn(), ...overrides,
  };
  return { props, tree: AnalyticsDateRangeControls(props) as ElementLike };
}

function childrenOf(element: ElementLike): ElementLike[] {
  return React.Children.toArray(element.props.children).filter(React.isValidElement) as ElementLike[];
}
function findByType(element: ElementLike, type: unknown): ElementLike[] {
  const direct = element.type === type ? [element] : [];
  return [...direct, ...childrenOf(element).flatMap((child) => findByType(child, type))];
}

describe('AnalyticsDateRangeControls', () => {
  it('exposes accessible presets and controlled From/To controls', () => {
    const onPresetChange = jest.fn();
    const { tree } = renderControls({ onPresetChange });
    const labels = findByType(tree, Typography);
    const fields = findByType(tree, TextField);
    const buttons = findByType(tree, Button);

    expect(labels.map((label) => label.props.htmlFor).filter(Boolean)).toEqual(['analytics-from', 'analytics-to']);
    expect(fields.map((field) => field.props.inputProps)).toEqual([
      { 'aria-label': 'From date' }, { 'aria-label': 'To date' },
    ]);
    expect(buttons.map((button) => button.props.children)).toEqual(['7D', '30D', '90D', 'YTD']);
    (buttons[2].props.onClick as () => void)();
    expect(onPresetChange).toHaveBeenCalledWith('90d');
  });

  it('keeps custom date inputs controlled and forwards updates', () => {
    const onFromChange = jest.fn(); const onToChange = jest.fn();
    const { tree } = renderControls({ onFromChange, onToChange });
    const [fromField, toField] = findByType(tree, TextField);
    expect(fromField.props.value).toBe('2026-07-01');
    expect(toField.props.value).toBe('2026-07-14');
    (fromField.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '2026-07-02' } });
    (toField.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '2026-07-15' } });
    expect(onFromChange).toHaveBeenCalledWith('2026-07-02');
    expect(onToChange).toHaveBeenCalledWith('2026-07-15');
    expect(findByType(tree, Stack).some((stack) => stack.props.direction
      && JSON.stringify(stack.props.direction) === JSON.stringify({ xs: 'column', sm: 'row' }))).toBe(true);
  });
});

describe('analytics report helpers', () => {
  it('creates deterministic 7d/30d/90d/YTD ranges', () => {
    const now = new Date('2026-07-22T12:00:00Z');
    expect(analyticsRangeForPreset('7d', now)).toEqual({ from: '2026-07-16', to: '2026-07-22' });
    expect(analyticsRangeForPreset('30d', now).from).toBe('2026-06-23');
    expect(analyticsRangeForPreset('90d', now).from).toBe('2026-04-24');
    expect(analyticsRangeForPreset('ytd', now).from).toBe('2026-01-01');
  });

  it('exports the filtered listing rows as valid escaped CSV', () => {
    const row: ListingPerformance = {
      listingId: 'listing-1', productId: 'product-1', productName: 'Camera, "Pro"', productSku: 'SKU-1',
      marketplaceId: 'marketplace-1', marketplaceName: 'OLX', marketplaceListingId: 'remote-1',
      status: 'live', price: 120, revenue: 200, profit: 100, currency: 'PLN', sales: 2, views: 100,
      conversion: 2, watchers: 3, messages: 4,
    };
    const csv = analyticsCsv([row]);
    expect(csv).toContain('"Currency","Revenue","Profit"');
    expect(csv).toContain('"PLN","200","100"');
    expect(csv).toContain('"Camera, ""Pro"""');
    expect(csv.split('\n')).toHaveLength(2);
  });

  it('neutralizes spreadsheet formulas in provider and user controlled cells', () => {
    const row: ListingPerformance = {
      listingId: '\t=HYPERLINK("https://evil")', productId: 'product-1', productName: '\r+cmd|calc', productSku: null,
      marketplaceId: 'marketplace-1', marketplaceName: '@SUM(1+1)', marketplaceListingId: null,
      status: 'live', price: 1, revenue: null, profit: null, currency: null, sales: 0, views: 1,
      conversion: 0, watchers: 0, messages: 0,
    };
    const csv = analyticsCsv([row]);
    expect(csv).toContain('"\'\t=HYPERLINK(""https://evil"")"');
    expect(csv).toContain('"\'\r+cmd|calc"');
    expect(csv).toContain('"\'@SUM(1+1)"');
  });
});
