import type { ISettingsRepository } from '../../../application/ports/ISettingsRepository';
import {
  NOTIFICATION_EVENT_KEYS,
  type ApiKeySettingsSummary,
  type NotificationChannels,
  type NotificationEventKey,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
  type UserPreferences,
  type UserPreferencesPatch,
} from '../../../../shared/types';

export class InMemorySettingsRepository implements ISettingsRepository {
  private readonly users = new Map<string, UserPreferences>();
  private readonly notifications = new Map<string, NotificationPreferences>();

  private key(workspaceId: string, userId: string): string {
    return `${workspaceId}:${userId}`;
  }

  async getUserPreferences(workspaceId: string, userId: string): Promise<UserPreferences> {
    return (
      this.users.get(this.key(workspaceId, userId)) ?? {
        workspaceId,
        userId,
        themeMode: 'system',
        density: 'comfortable',
        revision: 0,
      }
    );
  }

  async updateUserPreferences(
    workspaceId: string,
    userId: string,
    patch: UserPreferencesPatch
  ): Promise<UserPreferences> {
    // No await/read gap: independent patches cannot interleave between read and write.
    const current =
      this.users.get(this.key(workspaceId, userId)) ??
      ({ workspaceId, userId, themeMode: 'system', density: 'comfortable', revision: 0 } as const);
    const next = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.users.set(this.key(workspaceId, userId), next);
    return next;
  }

  async getNotificationPreferences(
    workspaceId: string,
    userId: string
  ): Promise<NotificationPreferences> {
    return (
      this.notifications.get(this.key(workspaceId, userId)) ??
      this.defaultNotifications(workspaceId, userId)
    );
  }

  async updateNotificationPreferences(
    workspaceId: string,
    userId: string,
    patch: NotificationPreferencesPatch
  ): Promise<NotificationPreferences> {
    // One synchronous map replacement mirrors the production statement's all-or-nothing write.
    const current =
      this.notifications.get(this.key(workspaceId, userId)) ??
      this.defaultNotifications(workspaceId, userId);
    const events = { ...current.events };
    for (const [event, channels] of Object.entries(patch.events) as Array<
      [NotificationEventKey, Partial<NotificationChannels>]
    >) {
      events[event] = { ...events[event], ...channels };
    }
    const next = { ...current, events, updatedAt: new Date().toISOString() };
    this.notifications.set(this.key(workspaceId, userId), next);
    return next;
  }

  async getApiKeySummary(_workspaceId: string): Promise<ApiKeySettingsSummary> {
    return { total: 0, active: 0, revoked: 0 };
  }

  private defaultNotifications(workspaceId: string, userId: string): NotificationPreferences {
    const events = Object.fromEntries(
      NOTIFICATION_EVENT_KEYS.map((event) => [
        event,
        { email: true, inApp: true, telegram: false } satisfies NotificationChannels,
      ])
    ) as Record<NotificationEventKey, NotificationChannels>;
    return { workspaceId, userId, events };
  }
}
