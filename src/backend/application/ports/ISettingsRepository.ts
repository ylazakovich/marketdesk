import type {
  ApiKeySettingsSummary,
  NotificationPreferences,
  NotificationPreferencesPatch,
  UserPreferences,
  UserPreferencesPatch,
} from '../../../shared/types';

export interface ISettingsRepository {
  getUserPreferences(workspaceId: string, userId: string): Promise<UserPreferences>;
  updateUserPreferences(
    workspaceId: string,
    userId: string,
    patch: UserPreferencesPatch
  ): Promise<UserPreferences>;
  getNotificationPreferences(workspaceId: string, userId: string): Promise<NotificationPreferences>;
  updateNotificationPreferences(
    workspaceId: string,
    userId: string,
    patch: NotificationPreferencesPatch
  ): Promise<NotificationPreferences>;
  getApiKeySummary(workspaceId: string): Promise<ApiKeySettingsSummary>;
}
