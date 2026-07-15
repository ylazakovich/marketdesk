import React from 'react';
import { Stack, TextField, Typography } from '@mui/material';
import { AnalyticsDateRangeControls } from './AnalyticsPage';

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function renderControls(overrides: Partial<React.ComponentProps<typeof AnalyticsDateRangeControls>> = {}) {
  const props: React.ComponentProps<typeof AnalyticsDateRangeControls> = {
    from: '2026-07-01',
    to: '2026-07-14',
    onFromChange: jest.fn(),
    onToChange: jest.fn(),
    ...overrides,
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
  it('exposes accessible From and To date controls', () => {
    const { tree } = renderControls();
    const labels = findByType(tree, Typography);
    const fields = findByType(tree, TextField);

    expect(labels.map((label) => label.props.htmlFor)).toEqual(['analytics-from', 'analytics-to']);
    expect(labels.map((label) => label.props.children)).toEqual(['From', 'To']);
    expect(fields.map((field) => field.props.id)).toEqual(['analytics-from', 'analytics-to']);
    expect(fields.map((field) => field.props.inputProps)).toEqual([
      { 'aria-label': 'From date' },
      { 'aria-label': 'To date' },
    ]);
  });

  it('keeps date inputs controlled and forwards updates', () => {
    const onFromChange = jest.fn();
    const onToChange = jest.fn();
    const { tree } = renderControls({ onFromChange, onToChange });
    const [fromField, toField] = findByType(tree, TextField);

    expect(fromField.props.value).toBe('2026-07-01');
    expect(toField.props.value).toBe('2026-07-14');

    (fromField.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: '2026-07-02' },
    });
    (toField.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: '2026-07-15' },
    });

    expect(onFromChange).toHaveBeenCalledWith('2026-07-02');
    expect(onToChange).toHaveBeenCalledWith('2026-07-15');
  });

  it('uses a stacked layout on narrow screens and a row layout from sm up', () => {
    const { tree } = renderControls();

    expect(tree.type).toBe(Stack);
    expect(tree.props.direction).toEqual({ xs: 'column', sm: 'row' });
    expect(tree.props.alignItems).toBe('stretch');
  });
});
