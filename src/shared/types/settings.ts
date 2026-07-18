import type { AutonomyLevel, HermesGuardrails, MarketplaceKey } from './index';

export type WorkspaceLanguage = 'en' | 'pl';
export type SettingsThemeMode = 'system' | 'light' | 'dark';
export type SettingsDensity = 'comfortable' | 'compact';

export const NOTIFICATION_EVENT_KEYS = [
  'new_sale',
  'competitor_price_change',
  'listing_needs_attention',
  'sync_error',
  'weekly_performance_report',
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

export interface WorkspaceSettings {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  language: WorkspaceLanguage;
  updatedAt: string;
}

export interface UserPreferences {
  workspaceId: string;
  userId: string;
  themeMode: SettingsThemeMode;
  density: SettingsDensity;
  revision: number;
  updatedAt?: string;
}

export interface NotificationChannels {
  email: boolean;
  inApp: boolean;
  telegram: boolean;
}

export interface NotificationPreferences {
  workspaceId: string;
  userId: string;
  events: Record<NotificationEventKey, NotificationChannels>;
  updatedAt?: string;
}

export interface HermesSettings {
  autonomyLevel: AutonomyLevel;
  guardrails: HermesGuardrails;
  updatedAt: string;
}

export type IntegrationSettingsCategory = 'marketplace' | 'telegram' | 'api_keys';

export interface ApiKeySettingsSummary {
  total: number;
  active: number;
  revoked: number;
}

interface IntegrationSettingsStatusBase {
  id: string;
  name: string;
  available: boolean;
  configured: boolean;
}

export type IntegrationSettingsStatus =
  | (IntegrationSettingsStatusBase & {
      category: 'marketplace';
      providerKey: MarketplaceKey;
    })
  | (IntegrationSettingsStatusBase & {
      category: 'telegram';
    })
  | (IntegrationSettingsStatusBase & {
      category: 'api_keys';
      apiKeySummary: ApiKeySettingsSummary;
    });

export interface IntegrationsSettings {
  items: IntegrationSettingsStatus[];
}

export type WorkspaceSettingsPatch = Partial<
  Pick<WorkspaceSettings, 'name' | 'currency' | 'timezone' | 'language'>
>;
export type UserPreferencesPatch = Partial<Pick<UserPreferences, 'themeMode' | 'density'>>;
export interface NotificationPreferencesPatch {
  events: Partial<Record<NotificationEventKey, Partial<NotificationChannels>>>;
}
export interface HermesSettingsPatch {
  autonomyLevel?: AutonomyLevel;
  guardrails?: Partial<HermesGuardrails>;
}
