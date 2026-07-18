import React from 'react';
import { Button, Typography } from '@mui/material';
import {
  ApplicationInfoBlock,
  mapSettingsFieldErrors,
  SettingsSectionNavigation,
  shouldHydrateWorkspaceDraft,
  workspaceSettingsPatch,
  settingsSections,
  type SettingsSection,
} from './SettingsPage';

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function childrenOf(element: ElementLike): ElementLike[] {
  return React.Children.toArray(element.props.children).filter(
    React.isValidElement
  ) as ElementLike[];
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

describe('SettingsPage shell navigation', () => {
  it('marks General as the default active section and exposes section captions', () => {
    const tree = SettingsSectionNavigation({
      activeSection: 'general',
      onSectionChange: jest.fn(),
    }) as ElementLike;

    const buttons = findByType(tree, Button);
    const labels = findByType(tree, Typography).map((node) => textContent(node));

    expect(buttons).toHaveLength(settingsSections.length);
    expect(buttons[0]?.props.variant).toBe('contained');
    expect(buttons[0]?.props['aria-current']).toBe('page');
    expect(buttons[1]?.props['aria-current']).toBeUndefined();
    expect(labels).toEqual(expect.arrayContaining(['General', 'Workspace basics']));
  });

  it('invokes navigation updates for another representative section', () => {
    const onSectionChange = jest.fn<void, [SettingsSection]>();
    const tree = SettingsSectionNavigation({
      activeSection: 'general',
      onSectionChange,
    }) as ElementLike;

    const hermesButton = findByType(tree, Button).find((button) =>
      textContent(button).includes('Hermes AI')
    );
    hermesButton?.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);

    expect(onSectionChange).toHaveBeenCalledWith('hermes');
  });

  it('moves active styling when Notifications becomes the selected section', () => {
    const tree = SettingsSectionNavigation({
      activeSection: 'notifications',
      onSectionChange: jest.fn(),
    }) as ElementLike;

    const notificationsButton = findByType(tree, Button).find((button) =>
      textContent(button).includes('Notifications')
    );

    expect(notificationsButton?.props.variant).toBe('contained');
    expect(textContent(notificationsButton)).toContain('Channels by event');
  });

  it('shows the installed release version in the About block', () => {
    const tree = ApplicationInfoBlock({ version: 'v0.10.0' }) as ElementLike;

    expect(textContent(tree)).toContain('Application version');
    expect(textContent(tree)).toContain('v0.10.0');
    expect(textContent(tree)).not.toMatch(/commit|sha|branch|dirty/i);
  });

  it('shows an honest fallback when application information cannot be loaded', () => {
    const tree = ApplicationInfoBlock({ isError: true }) as ElementLike;

    expect(textContent(tree)).toContain('Version unavailable');
  });

  it('preserves a dirty workspace draft on refetch but hydrates a changed principal', () => {
    expect(
      shouldHydrateWorkspaceDraft({
        initializedPrincipal: 'workspace:user-a',
        principalKey: 'workspace:user-a',
        baselineSnapshot: 'old',
        incomingSnapshot: 'new',
        dirty: true,
      })
    ).toBe(false);
    expect(
      shouldHydrateWorkspaceDraft({
        initializedPrincipal: 'workspace:user-a',
        principalKey: 'workspace:user-b',
        baselineSnapshot: 'old',
        incomingSnapshot: 'new',
        dirty: true,
      })
    ).toBe(true);
  });

  it('maps backend validation details to General field errors', () => {
    expect(
      mapSettingsFieldErrors({
        data: {
          error: {
            details: [
              { field: 'timezone', message: 'Invalid IANA timezone' },
              { field: 'unknown', message: 'ignored' },
            ],
          },
        },
      })
    ).toEqual({ timezone: 'Invalid IANA timezone' });
  });

  it('sends only fields changed from the current principal baseline', () => {
    const baseline = {
      name: 'Old name',
      currency: 'PLN',
      timezone: 'Europe/Warsaw',
      language: 'en' as const,
    };
    const staleDraft = { ...baseline, name: 'New name' };

    expect(workspaceSettingsPatch(baseline, staleDraft)).toEqual({ name: 'New name' });
  });
});
