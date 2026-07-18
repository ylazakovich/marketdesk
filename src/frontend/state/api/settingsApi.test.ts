import { defaultSerializeQueryArgs } from '@reduxjs/toolkit/query';
import {
  hermesAutomationPatch,
  notificationChannelPatch,
  settingsPrincipalKey,
  settingsRequest,
} from './settingsApi';

describe('settings API contract', () => {
  it('uses principal-scoped routes without caller supplied workspace or user ids', () => {
    expect(settingsRequest.workspace()).toBe('/settings/workspace');
    expect(settingsRequest.preferences()).toBe('/settings/preferences');
    expect(settingsRequest.notifications()).toBe('/settings/notifications');
    expect(settingsRequest.hermes()).toBe('/settings/hermes');
    expect(settingsRequest.integrations()).toBe('/settings/integrations');

    expect(
      Object.values(settingsRequest)
        .map((request) => request())
        .join(' ')
    ).not.toMatch(/workspaceId|userId|token|secret/i);
  });

  it('serializes two users in one workspace into distinct RTK cache entries', () => {
    const principalA = { workspaceId: 'workspace-1', userId: 'user-a' };
    const principalB = { workspaceId: 'workspace-1', userId: 'user-b' };
    const serialize = (queryArgs: typeof principalA) =>
      defaultSerializeQueryArgs({
        endpointName: 'getUserPreferences',
        endpointDefinition: {} as never,
        queryArgs,
      });

    expect(settingsPrincipalKey(principalA)).not.toBe(settingsPrincipalKey(principalB));
    expect(serialize(principalA)).not.toBe(serialize(principalB));
  });

  it('builds minimal normalized notification and Hermes automation mutations', () => {
    expect(notificationChannelPatch('sync_error', 'telegram', true)).toEqual({
      events: { sync_error: { telegram: true } },
    });
    expect(hermesAutomationPatch('autoRelist', true)).toEqual({
      guardrails: { autoRelist: true },
    });
  });
});
