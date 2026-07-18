import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type { ISettingsRepository } from '../../../application/ports/ISettingsRepository';
import { ValidationError } from '../../../domain/shared/DomainError';
import {
  NOTIFICATION_EVENT_KEYS,
  type ApiKeySettingsSummary,
  type NotificationChannels,
  type NotificationEventKey,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
  type SettingsDensity,
  type SettingsThemeMode,
  type UserPreferences,
  type UserPreferencesPatch,
} from '../../../../shared/types';

interface UserPreferenceRow {
  workspace_id: string;
  user_id: string;
  theme_mode: SettingsThemeMode;
  density: SettingsDensity;
  revision: string | number;
  updated_at: Date | string;
}

interface NotificationPreferenceRow {
  event_key: NotificationEventKey;
  email_enabled: boolean;
  in_app_enabled: boolean;
  telegram_enabled: boolean;
  updated_at: Date | string;
}

const defaultChannels = (): NotificationChannels => ({
  email: true,
  inApp: true,
  telegram: false,
});

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export class SettingsRepository implements ISettingsRepository {
  private readonly queryClient?: Pool | PoolClient;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client ?? pool;
  }

  async getUserPreferences(workspaceId: string, userId: string): Promise<UserPreferences> {
    const result = await query<UserPreferenceRow>(
      `SELECT workspace_id, user_id, theme_mode, density, revision, updated_at
         FROM user_preferences
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
      this.queryClient
    );
    const row = result.rows[0];
    return row
      ? {
          workspaceId: row.workspace_id,
          userId: row.user_id,
          themeMode: row.theme_mode,
          density: row.density,
          revision: Number(row.revision),
          updatedAt: iso(row.updated_at),
        }
      : { workspaceId, userId, themeMode: 'system', density: 'comfortable', revision: 0 };
  }

  async updateUserPreferences(
    workspaceId: string,
    userId: string,
    patch: UserPreferencesPatch
  ): Promise<UserPreferences> {
    const result = await query<UserPreferenceRow>(
      `INSERT INTO user_preferences
         (workspace_id, user_id, theme_mode, density, revision, created_at, updated_at)
       VALUES ($1, $2, COALESCE($3, 'system'), COALESCE($4, 'comfortable'), 1, NOW(), NOW())
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET
         theme_mode = COALESCE($3, user_preferences.theme_mode),
         density = COALESCE($4, user_preferences.density),
         revision = user_preferences.revision + 1,
         updated_at = NOW()
       RETURNING workspace_id, user_id, theme_mode, density, revision, updated_at`,
      [workspaceId, userId, patch.themeMode ?? null, patch.density ?? null],
      this.queryClient
    );
    const row = result.rows[0]!;
    return {
      workspaceId: row.workspace_id,
      userId: row.user_id,
      themeMode: row.theme_mode,
      density: row.density,
      revision: Number(row.revision),
      updatedAt: iso(row.updated_at),
    };
  }

  async getNotificationPreferences(
    workspaceId: string,
    userId: string
  ): Promise<NotificationPreferences> {
    const result = await query<NotificationPreferenceRow>(
      `SELECT event_key, email_enabled, in_app_enabled, telegram_enabled, updated_at
         FROM notification_preferences
        WHERE workspace_id = $1 AND user_id = $2
        ORDER BY event_key`,
      [workspaceId, userId],
      this.queryClient
    );
    const events = Object.fromEntries(
      NOTIFICATION_EVENT_KEYS.map((key) => [key, defaultChannels()])
    ) as Record<NotificationEventKey, NotificationChannels>;
    let updatedAt: string | undefined;
    for (const row of result.rows) {
      events[row.event_key] = {
        email: row.email_enabled,
        inApp: row.in_app_enabled,
        telegram: row.telegram_enabled,
      };
      const candidate = iso(row.updated_at);
      if (!updatedAt || candidate > updatedAt) updatedAt = candidate;
    }
    return { workspaceId, userId, events, updatedAt };
  }

  async updateNotificationPreferences(
    workspaceId: string,
    userId: string,
    patch: NotificationPreferencesPatch
  ): Promise<NotificationPreferences> {
    const entries = Object.entries(patch.events) as Array<
      [NotificationEventKey, Partial<NotificationChannels>]
    >;
    if (entries.length === 0) {
      throw new ValidationError('Notification patch must contain at least one event');
    }
    const values: unknown[] = [workspaceId, userId];
    const tuples = entries.map(([eventKey, channels], index) => {
      const offset = 3 + index * 4;
      values.push(
        eventKey,
        channels.email ?? null,
        channels.inApp ?? null,
        channels.telegram ?? null
      );
      return `($${offset}::varchar, $${offset + 1}::boolean, $${offset + 2}::boolean, $${offset + 3}::boolean)`;
    });

    // One UPSERT statement is the whole operation: no partial writes or stale read-derived channels.
    const result = await query<NotificationPreferenceRow>(
      `WITH patch(event_key, email_enabled, in_app_enabled, telegram_enabled) AS (
         VALUES ${tuples.join(', ')}
       ), upserted AS (
         INSERT INTO notification_preferences (
           workspace_id, user_id, event_key, email_enabled, in_app_enabled,
           telegram_enabled, revision, created_at, updated_at
         )
         SELECT $1, $2, patch.event_key,
                COALESCE(patch.email_enabled, TRUE), COALESCE(patch.in_app_enabled, TRUE),
                COALESCE(patch.telegram_enabled, FALSE), 1, NOW(), NOW()
           FROM patch
         ON CONFLICT (workspace_id, user_id, event_key) DO UPDATE SET
           email_enabled = COALESCE(
             (SELECT value.email_enabled FROM patch value
               WHERE value.event_key = EXCLUDED.event_key),
             notification_preferences.email_enabled
           ),
           in_app_enabled = COALESCE(
             (SELECT value.in_app_enabled FROM patch value
               WHERE value.event_key = EXCLUDED.event_key),
             notification_preferences.in_app_enabled
           ),
           telegram_enabled = COALESCE(
             (SELECT value.telegram_enabled FROM patch value
               WHERE value.event_key = EXCLUDED.event_key),
             notification_preferences.telegram_enabled
           ),
           revision = notification_preferences.revision + 1,
           updated_at = NOW()
         RETURNING workspace_id, user_id, event_key, email_enabled, in_app_enabled,
                   telegram_enabled, revision, updated_at
       )
       SELECT * FROM upserted
       UNION ALL
       SELECT existing.workspace_id, existing.user_id, existing.event_key,
              existing.email_enabled, existing.in_app_enabled, existing.telegram_enabled,
              existing.revision, existing.updated_at
         FROM notification_preferences existing
        WHERE existing.workspace_id = $1 AND existing.user_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM upserted WHERE upserted.event_key = existing.event_key
          )`,
      values,
      this.queryClient
    );
    const events = Object.fromEntries(
      NOTIFICATION_EVENT_KEYS.map((key) => [key, defaultChannels()])
    ) as Record<NotificationEventKey, NotificationChannels>;
    let updatedAt: string | undefined;
    for (const row of result.rows) {
      events[row.event_key] = {
        email: row.email_enabled,
        inApp: row.in_app_enabled,
        telegram: row.telegram_enabled,
      };
      const candidate = iso(row.updated_at);
      if (!updatedAt || candidate > updatedAt) updatedAt = candidate;
    }
    return { workspaceId, userId, events, updatedAt };
  }

  async getApiKeySummary(workspaceId: string): Promise<ApiKeySettingsSummary> {
    const result = await query<{ total: string; active: string; revoked: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE revoked IS NOT TRUE)::text AS active,
              COUNT(*) FILTER (WHERE revoked IS TRUE)::text AS revoked
         FROM api_keys
        WHERE workspace_id = $1`,
      [workspaceId],
      this.queryClient
    );
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      revoked: Number(row?.revoked ?? 0),
    };
  }
}
