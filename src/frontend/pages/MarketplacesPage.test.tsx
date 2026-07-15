import React from 'react';
import { Box, Button, FormHelperText, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import type { Marketplace, SyncMode } from '@shared/types';
import { MarketplaceCard } from './MarketplacesPage';

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function marketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'marketplace-olx',
    workspaceId: 'ws-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    syncMode: 'manual',
    lastSyncAt: undefined,
    errorCount: 0,
    capacity: 100,
    createdAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

function renderCard(overrides: Partial<Marketplace> = {}) {
  const props = {
    marketplace: marketplace(overrides),
    busy: false,
    onSync: jest.fn(),
    onConnect: jest.fn(),
    onSyncMode: jest.fn(),
  };
  return { props, tree: MarketplaceCard(props) as ElementLike };
}

function childrenOf(element: ElementLike): ElementLike[] {
  return React.Children.toArray(element.props.children).filter(React.isValidElement) as ElementLike[];
}

function findByType(element: ElementLike, type: unknown): ElementLike[] {
  const direct = element.type === type ? [element] : [];
  return [...direct, ...childrenOf(element).flatMap((child) => findByType(child, type))];
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (React.isValidElement(node)) return textContent((node as ElementLike).props.children);
  return '';
}

describe('MarketplaceCard', () => {
  it('uses recognizable OLX branding and readable status labels', () => {
    const { tree } = renderCard();
    const logo = findByType(tree, Box).find((el) => el.props['aria-label'] === 'OLX marketplace logo');
    const copy = findByType(tree, Typography).map((el) => textContent(el));

    expect(logo?.props.children).toBe('OLX');
    expect(copy).toContain('Last sync');
    expect(copy).toContain('Never synced');
    expect(copy).toContain('Synchronization');
    expect(copy).toContain('Manual');
    expect(copy).toContain('Sync errors');
    expect(copy).toContain('No errors');
    expect(copy).not.toContain('Capacity');
  });

  it('labels sync mode, explains modes, and hides unsupported realtime selection', () => {
    const { tree } = renderCard({ syncMode: 'hourly' });
    const labels = findByType(tree, InputLabel);
    const selects = findByType(tree, Select);
    const options = findByType(tree, MenuItem);
    const helpers = findByType(tree, FormHelperText);

    expect(labels.map((label) => textContent(label))).toContain('Sync mode');
    expect(selects[0]?.props.value).toBe('hourly');
    expect(options.map((option) => option.props.value)).toEqual(['manual', 'hourly']);
    expect(helpers.map((helper) => textContent(helper))).toContain(
      'Run automatic synchronization once per hour.',
    );
  });

  it('keeps unsupported realtime visible but disabled if returned by the API', () => {
    const { tree } = renderCard({ syncMode: 'realtime' as SyncMode });
    const options = findByType(tree, MenuItem);
    const realtime = options.find((option) => option.props.value === 'realtime');
    const helpers = findByType(tree, FormHelperText);

    expect(realtime?.props.disabled).toBe(true);
    expect(helpers.map((helper) => textContent(helper))).toContain(
      'Real-time sync is not available for the current OLX integration yet.',
    );
  });

  it('makes non-zero sync errors prominent and actionable', () => {
    const { tree } = renderCard({ errorCount: 3 });
    const copy = findByType(tree, Typography).map((el) => textContent(el));
    const buttons = findByType(tree, Button).map((el) => textContent(el));

    expect(copy).toContain('3 needs review');
    expect(buttons).toContain('Review sync issues');
  });
});
