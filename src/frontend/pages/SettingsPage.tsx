// Workspace settings: visual settings shell with section navigation for general
// preferences, Hermes autonomy, notifications, integrations, appearance, and security.
import React, { useEffect, useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import {
  Box,
  Alert,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import NotificationsIcon from '@mui/icons-material/NotificationsNone';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import KeyIcon from '@mui/icons-material/KeyOutlined';
import PaletteIcon from '@mui/icons-material/PaletteOutlined';
import TelegramIcon from '@mui/icons-material/Telegram';
import SecurityIcon from '@mui/icons-material/SecurityOutlined';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import type {
  AutonomyLevel,
  NotificationChannels,
  NotificationEventKey,
  WorkspaceLanguage,
  WorkspaceSettingsPatch,
} from '@shared/types';
import { AUTONOMY_LEVEL_LIST } from '@shared/constants';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { setWorkspace, setAutonomyLevel } from '../state/slices/workspaceSlice.js';
import { setThemeMode, enqueueToast, type ThemeMode } from '../state/slices/uiSlice.js';
import { useApplicationInfo } from '../services/hooks/index.js';
import {
  useGetHermesSettingsQuery,
  useGetIntegrationSettingsQuery,
  useGetNotificationPreferencesQuery,
  useGetUserPreferencesQuery,
  useGetWorkspaceSettingsQuery,
  hermesAutomationPatch,
  notificationChannelPatch,
  settingsPrincipalKey,
  useUpdateHermesSettingsMutation,
  useUpdateNotificationPreferencesMutation,
  useUpdateUserPreferencesMutation,
  useUpdateWorkspaceSettingsMutation,
} from '../state/api/settingsApi.js';
import { AUTONOMY_LABELS, AUTONOMY_DESCRIPTIONS } from '../utils/labels.js';
import { Card } from '../components/common/Card.js';

const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CZK', 'UAH'];

export type SettingsSection =
  | 'general'
  | 'hermes'
  | 'notifications'
  | 'marketplaces'
  | 'apiKeys'
  | 'appearance'
  | 'telegram'
  | 'security'
  | 'about';

export const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  caption: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'general',
    label: 'General',
    caption: 'Workspace basics',
    icon: <TuneIcon fontSize="small" />,
  },
  {
    id: 'hermes',
    label: 'Hermes AI',
    caption: 'Autonomy and automation',
    icon: <AutoAwesomeIcon fontSize="small" />,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    caption: 'Channels by event',
    icon: <NotificationsIcon fontSize="small" />,
  },
  {
    id: 'marketplaces',
    label: 'Marketplace Accounts',
    caption: 'Seller account health',
    icon: <StorefrontIcon fontSize="small" />,
  },
  {
    id: 'apiKeys',
    label: 'API Keys',
    caption: 'Programmatic access',
    icon: <KeyIcon fontSize="small" />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    caption: 'Theme and density',
    icon: <PaletteIcon fontSize="small" />,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    caption: 'Bot notifications',
    icon: <TelegramIcon fontSize="small" />,
  },
  {
    id: 'security',
    label: 'Security',
    caption: 'Account protection',
    icon: <SecurityIcon fontSize="small" />,
  },
  {
    id: 'about',
    label: 'About',
    caption: 'Application information',
    icon: <InfoIcon fontSize="small" />,
  },
];

const notificationRows: Array<[NotificationEventKey, string]> = [
  ['new_sale', 'New sale'],
  ['competitor_price_change', 'Competitor price change'],
  ['listing_needs_attention', 'Listing needs attention'],
  ['sync_error', 'Sync errors'],
  ['weekly_performance_report', 'Weekly performance report'],
];

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

type GeneralField = 'name' | 'currency' | 'timezone' | 'language';
export type GeneralFieldErrors = Partial<Record<GeneralField, string>>;

export function mapSettingsFieldErrors(err: unknown): GeneralFieldErrors {
  const details = (err as { data?: { error?: { details?: unknown } } })?.data?.error?.details;
  if (!Array.isArray(details)) return {};
  const mapped: GeneralFieldErrors = {};
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    const issue = detail as { field?: unknown; path?: unknown[]; message?: string };
    const field = issue.field ?? issue.path?.[0];
    if (
      typeof field === 'string' &&
      ['name', 'currency', 'timezone', 'language'].includes(field) &&
      typeof issue.message === 'string'
    ) {
      mapped[field as GeneralField] = issue.message;
    }
  }
  return mapped;
}

interface WorkspaceDraft {
  name: string;
  currency: string;
  timezone: string;
  language: WorkspaceLanguage;
}

export const workspaceDraftSnapshot = (draft: WorkspaceDraft): string => JSON.stringify(draft);

export function workspaceSettingsPatch(
  baseline: WorkspaceDraft,
  draft: WorkspaceDraft
): WorkspaceSettingsPatch {
  const patch: WorkspaceSettingsPatch = {};
  if (draft.name !== baseline.name) patch.name = draft.name;
  if (draft.currency !== baseline.currency) patch.currency = draft.currency;
  if (draft.timezone !== baseline.timezone) patch.timezone = draft.timezone;
  if (draft.language !== baseline.language) patch.language = draft.language;
  return patch;
}

export function shouldHydrateWorkspaceDraft(input: {
  initializedPrincipal: string | null;
  principalKey: string;
  baselineSnapshot: string | null;
  incomingSnapshot: string;
  dirty: boolean;
}): boolean {
  return (
    input.initializedPrincipal !== input.principalKey ||
    input.baselineSnapshot === null ||
    (!input.dirty && input.baselineSnapshot !== input.incomingSnapshot)
  );
}

function SettingsQueryState({
  isLoading,
  isError,
  retry,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  retry: () => unknown;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" role="status">
        <CircularProgress size={18} />
        <Typography>Loading settings…</Typography>
      </Stack>
    );
  }
  if (isError) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => retry()}>
            Retry
          </Button>
        }
      >
        Settings could not be loaded.
      </Alert>
    );
  }
  return <>{children}</>;
}

export function ApplicationInfoBlock({
  version,
  isLoading = false,
  isError = false,
}: {
  version?: string;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const displayVersion = isLoading
    ? 'Loading…'
    : isError || !version
      ? 'Version unavailable'
      : version;

  return (
    <Stack spacing={0.75}>
      <Typography variant="body2" color="text.secondary">
        Application version
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>
        {displayVersion}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Version embedded in the currently running MarketDesk artifact.
      </Typography>
    </Stack>
  );
}

const SettingsPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const workspace = useAppSelector((s) => s.workspace);
  const user = useAppSelector((s) => s.auth.user);
  const themeMode = useAppSelector((s) => s.ui.themeMode);
  const principal =
    workspace.id && user?.id ? { workspaceId: workspace.id, userId: user.id } : null;
  const principalCacheKey = principal ? settingsPrincipalKey(principal) : '';
  const queryArg = principal ?? skipToken;
  const {
    data: applicationInfo,
    isLoading: applicationInfoLoading,
    isError: applicationInfoError,
  } = useApplicationInfo();
  const workspaceSettings = useGetWorkspaceSettingsQuery(queryArg);
  const preferences = useGetUserPreferencesQuery(queryArg);
  const notifications = useGetNotificationPreferencesQuery(queryArg);
  const hermesSettings = useGetHermesSettingsQuery(queryArg);
  const integrations = useGetIntegrationSettingsQuery(queryArg);

  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [name, setName] = useState(workspace.name);
  const [currency, setCurrency] = useState(workspace.currency);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [language, setLanguage] = useState<WorkspaceLanguage>('en');
  const [baseline, setBaseline] = useState<WorkspaceDraft | null>(null);
  const [initializedPrincipal, setInitializedPrincipal] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<GeneralFieldErrors>({});

  const [updateWorkspace, { isLoading: saving }] = useUpdateWorkspaceSettingsMutation();
  const [updateHermes, { isLoading: savingHermes }] = useUpdateHermesSettingsMutation();
  const [updatePreferences, { isLoading: savingPreferences }] = useUpdateUserPreferencesMutation();
  const [updateNotifications, { isLoading: savingNotifications }] =
    useUpdateNotificationPreferencesMutation();

  const draft = { name, currency, timezone, language };
  const baselineSnapshot = baseline ? workspaceDraftSnapshot(baseline) : null;
  const dirty = baselineSnapshot !== null && workspaceDraftSnapshot(draft) !== baselineSnapshot;

  useEffect(() => {
    if (!workspaceSettings.data || !principalCacheKey) return;
    const incoming: WorkspaceDraft = workspaceSettings.data;
    const incomingSnapshot = workspaceDraftSnapshot(incoming);
    if (
      !shouldHydrateWorkspaceDraft({
        initializedPrincipal,
        principalKey: principalCacheKey,
        baselineSnapshot,
        incomingSnapshot,
        dirty,
      })
    ) {
      return;
    }
    setName(incoming.name);
    setCurrency(incoming.currency);
    setTimezone(incoming.timezone);
    setLanguage(incoming.language);
    setBaseline(incoming);
    setInitializedPrincipal(principalCacheKey);
    setFieldErrors({});
  }, [workspaceSettings.data, principalCacheKey, initializedPrincipal, baselineSnapshot, dirty]);

  useEffect(() => {
    if (preferences.data?.themeMode) dispatch(setThemeMode(preferences.data.themeMode));
  }, [preferences.data?.themeMode, principalCacheKey, dispatch]);

  const clearFieldError = (field: GeneralField) =>
    setFieldErrors((current) => ({ ...current, [field]: undefined }));

  const handleSaveProfile = async () => {
    if (!principal || !baseline) return;
    setFieldErrors({});
    try {
      const patch = workspaceSettingsPatch(baseline, draft);
      if (Object.keys(patch).length === 0) return;
      const updated = await updateWorkspace({ principal, patch }).unwrap();
      const updatedDraft: WorkspaceDraft = updated;
      setName(updated.name);
      setCurrency(updated.currency);
      setTimezone(updated.timezone);
      setLanguage(updated.language);
      setBaseline(updatedDraft);
      dispatch(
        setWorkspace({
          ...workspace,
          name: updated.name,
          currency: updated.currency,
          timezone: updated.timezone,
        })
      );
      dispatch(enqueueToast({ message: 'Workspace settings saved.', severity: 'success' }));
    } catch (err) {
      setFieldErrors(mapSettingsFieldErrors(err));
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleAutonomy = async (level: AutonomyLevel) => {
    if (!principal) return;
    try {
      await updateHermes({ principal, patch: { autonomyLevel: level } }).unwrap();
      dispatch(setAutonomyLevel(level));
      dispatch(
        enqueueToast({ message: `Autonomy set to ${AUTONOMY_LABELS[level]}.`, severity: 'success' })
      );
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleAutomation = async (
    field: 'autoCreateListings' | 'autoAdjustPricing' | 'autoRelist' | 'smartTitleAndSEO',
    enabled: boolean
  ) => {
    if (!principal) return;
    try {
      await updateHermes({ principal, patch: hermesAutomationPatch(field, enabled) }).unwrap();
      dispatch(enqueueToast({ message: 'Hermes automation saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleNotification = async (
    event: NotificationEventKey,
    channel: keyof NotificationChannels,
    enabled: boolean
  ) => {
    if (!principal) return;
    try {
      await updateNotifications({
        principal,
        patch: notificationChannelPatch(event, channel, enabled),
      }).unwrap();
      dispatch(enqueueToast({ message: 'Notification preference saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleTheme = async (mode: ThemeMode) => {
    if (!principal) return;
    try {
      await updatePreferences({ principal, patch: { themeMode: mode } }).unwrap();
      dispatch(setThemeMode(mode));
      dispatch(enqueueToast({ message: 'Appearance preference saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleDensity = async (density: 'comfortable' | 'compact') => {
    if (!principal) return;
    try {
      await updatePreferences({ principal, patch: { density } }).unwrap();
      dispatch(enqueueToast({ message: 'Density preference saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const renderIntegrationStatuses = (category?: 'marketplace' | 'telegram' | 'api_keys') => {
    const items = (integrations.data?.items ?? []).filter(
      (item) => !category || item.category === category
    );
    return (
      <SettingsQueryState
        isLoading={integrations.isLoading}
        isError={integrations.isError}
        retry={integrations.refetch}
      >
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            Read-only configuration status. Secret values and live connection claims are never
            returned here.
          </Typography>
          {items.length === 0 && (
            <Alert severity="info">No integrations are available in this category.</Alert>
          )}
          {items.map((integration) => (
            <Stack
              key={integration.id}
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Typography sx={{ fontWeight: 700 }}>{integration.name}</Typography>
                {integration.category === 'api_keys' && (
                  <Typography variant="caption" color="text.secondary">
                    {integration.apiKeySummary.active} active, {integration.apiKeySummary.revoked}{' '}
                    revoked
                  </Typography>
                )}
              </Box>
              <Chip
                size="small"
                label={
                  !integration.available
                    ? 'Unavailable'
                    : integration.configured
                      ? 'Configured'
                      : 'Not configured'
                }
                color={integration.configured ? 'success' : 'default'}
                variant="outlined"
              />
            </Stack>
          ))}
        </Stack>
      </SettingsQueryState>
    );
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return (
          <SettingsQueryState
            isLoading={workspaceSettings.isLoading}
            isError={workspaceSettings.isError}
            retry={workspaceSettings.refetch}
          >
            <Stack spacing={2.25}>
              <TextField
                label="Workspace name"
                value={name}
                disabled={!workspaceSettings.data || saving}
                error={Boolean(fieldErrors.name)}
                helperText={fieldErrors.name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFieldError('name');
                }}
                fullWidth
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Select
                  value={currency}
                  disabled={!workspaceSettings.data || saving}
                  error={Boolean(fieldErrors.currency)}
                  onChange={(e) => {
                    setCurrency(e.target.value);
                    clearFieldError('currency');
                  }}
                  fullWidth
                  aria-label="Default currency"
                >
                  {CURRENCIES.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c} — {c === 'PLN' ? 'Polish złoty' : c}
                    </MenuItem>
                  ))}
                </Select>
                <TextField
                  label="Timezone"
                  value={timezone}
                  disabled={!workspaceSettings.data || saving}
                  error={Boolean(fieldErrors.timezone)}
                  helperText={fieldErrors.timezone}
                  onChange={(e) => {
                    setTimezone(e.target.value);
                    clearFieldError('timezone');
                  }}
                  fullWidth
                />
              </Stack>
              {fieldErrors.currency && (
                <Typography color="error">{fieldErrors.currency}</Typography>
              )}
              <Select
                value={language}
                disabled={!workspaceSettings.data || saving}
                error={Boolean(fieldErrors.language)}
                onChange={(e) => {
                  setLanguage(e.target.value as WorkspaceLanguage);
                  clearFieldError('language');
                }}
                fullWidth
                aria-label="Language"
              >
                <MenuItem value="en">English</MenuItem>
                <MenuItem value="pl">Polski</MenuItem>
              </Select>
              {fieldErrors.language && (
                <Typography color="error">{fieldErrors.language}</Typography>
              )}
              <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                <Button
                  variant="outlined"
                  disabled={!workspaceSettings.data || saving}
                  onClick={() => {
                    if (!workspaceSettings.data) return;
                    const reset: WorkspaceDraft = workspaceSettings.data;
                    setName(reset.name);
                    setCurrency(reset.currency);
                    setTimezone(reset.timezone);
                    setLanguage(reset.language);
                    setBaseline(reset);
                    setFieldErrors({});
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSaveProfile}
                  disabled={!dirty || saving || !workspaceSettings.data}
                >
                  Save changes
                </Button>
              </Stack>
            </Stack>
          </SettingsQueryState>
        );
      case 'hermes':
        return (
          <SettingsQueryState
            isLoading={hermesSettings.isLoading}
            isError={hermesSettings.isError}
            retry={hermesSettings.refetch}
          >
            <Stack spacing={1.5}>
              {AUTONOMY_LEVEL_LIST.map((level) => {
                const selected = hermesSettings.data?.autonomyLevel === level;
                return (
                  <ButtonBase
                    key={level}
                    onClick={() => handleAutonomy(level)}
                    disabled={savingHermes || !hermesSettings.data}
                    aria-pressed={selected}
                    sx={{
                      p: 2,
                      borderRadius: 2.5,
                      width: '100%',
                      display: 'block',
                      textAlign: 'left',
                      border: (t) =>
                        `2px solid ${selected ? t.palette.primary.main : t.palette.divider}`,
                      bgcolor: selected ? 'action.selected' : 'background.paper',
                    }}
                  >
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      spacing={1}
                      sx={{ mb: 0.5 }}
                    >
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                        {AUTONOMY_LABELS[level]}
                      </Typography>
                      {selected && <CheckCircleIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {AUTONOMY_DESCRIPTIONS[level]}
                    </Typography>
                  </ButtonBase>
                );
              })}
              <Divider />
              <Typography variant="subtitle2">Automation controls</Typography>
              {(
                [
                  ['autoCreateListings', 'Automatically create listings'],
                  ['autoAdjustPricing', 'Automatically adjust pricing'],
                  ['autoRelist', 'Automatically relist'],
                  ['smartTitleAndSEO', 'Smart title and SEO'],
                ] as const
              ).map(([field, label]) => (
                <FormControlLabel
                  key={field}
                  control={
                    <Switch
                      disabled={savingHermes || !hermesSettings.data}
                      checked={hermesSettings.data?.guardrails[field] ?? false}
                      onChange={(event) => handleAutomation(field, event.target.checked)}
                    />
                  }
                  label={label}
                />
              ))}
            </Stack>
          </SettingsQueryState>
        );
      case 'notifications':
        return (
          <SettingsQueryState
            isLoading={notifications.isLoading}
            isError={notifications.isError}
            retry={notifications.refetch}
          >
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                Choose delivery channels independently for each event. Changes are saved
                immediately.
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr repeat(3, auto)' },
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <Typography variant="caption">Event</Typography>
                <Typography variant="caption">Email</Typography>
                <Typography variant="caption">In-app</Typography>
                <Typography variant="caption">Telegram</Typography>
                {notificationRows.map(([event, label]) => (
                  <React.Fragment key={event}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {label}
                    </Typography>
                    {(['email', 'inApp', 'telegram'] as const).map((channel) => (
                      <Switch
                        key={channel}
                        size="small"
                        disabled={!notifications.data || savingNotifications}
                        checked={notifications.data?.events[event][channel] ?? false}
                        onChange={(e) => handleNotification(event, channel, e.target.checked)}
                        slotProps={{ input: { 'aria-label': `${label} ${channel}` } }}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </Box>
            </Stack>
          </SettingsQueryState>
        );
      case 'appearance':
        return (
          <SettingsQueryState
            isLoading={preferences.isLoading}
            isError={preferences.isError}
            retry={preferences.refetch}
          >
            <Stack spacing={2}>
              <Select
                value={preferences.data?.themeMode ?? themeMode}
                disabled={!preferences.data || savingPreferences}
                onChange={(event) => handleTheme(event.target.value as ThemeMode)}
                aria-label="Theme preference"
              >
                <MenuItem value="system">Use system preference</MenuItem>
                <MenuItem value="light">Light</MenuItem>
                <MenuItem value="dark">Dark</MenuItem>
              </Select>
              <Select
                value={preferences.data?.density ?? 'comfortable'}
                disabled={!preferences.data || savingPreferences}
                onChange={(event) => handleDensity(event.target.value as 'comfortable' | 'compact')}
                aria-label="Interface density"
              >
                <MenuItem value="comfortable">Comfortable</MenuItem>
                <MenuItem value="compact">Compact</MenuItem>
              </Select>
            </Stack>
          </SettingsQueryState>
        );
      case 'marketplaces':
        return renderIntegrationStatuses('marketplace');
      case 'apiKeys':
        return renderIntegrationStatuses('api_keys');
      case 'telegram':
        return renderIntegrationStatuses('telegram');
      case 'security':
        return (
          <Placeholder
            title="Security controls"
            detail="Password, two-factor authentication, and active sessions belong here."
          />
        );
      case 'about':
        return (
          <ApplicationInfoBlock
            version={applicationInfo?.version}
            isLoading={applicationInfoLoading}
            isError={applicationInfoError}
          />
        );
      default:
        return null;
    }
  };

  const activeMeta =
    settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];
  return (
    <Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '300px minmax(0, 1fr)' },
          gap: 2.5,
          alignItems: 'start',
        }}
      >
        <Card title="Settings sections" subtitle="Choose what to configure" contentSx={{ p: 1.25 }}>
          <SettingsSectionNavigation
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />
        </Card>

        <Card
          title={activeMeta.label}
          subtitle={activeMeta.caption}
          sx={{ borderRadius: 4 }}
          contentSx={{ p: { xs: 2, md: 3 } }}
        >
          {renderSection()}
        </Card>
      </Box>
    </Box>
  );
};

export function SettingsSectionNavigation({
  activeSection,
  onSectionChange,
}: {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  return (
    <Stack spacing={0.75}>
      {settingsSections.map((section) => {
        const active = activeSection === section.id;
        return (
          <Button
            key={section.id}
            onClick={() => onSectionChange(section.id)}
            startIcon={section.icon}
            fullWidth
            variant={active ? 'contained' : 'text'}
            color={active ? 'primary' : 'inherit'}
            aria-current={active ? 'page' : undefined}
            sx={{ justifyContent: 'flex-start', textTransform: 'none', borderRadius: 2, py: 1.1 }}
          >
            <Box sx={{ textAlign: 'left', minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                {section.label}
              </Typography>
              <Typography variant="caption" sx={{ opacity: active ? 0.9 : 0.68 }} noWrap>
                {section.caption}
              </Typography>
            </Box>
          </Button>
        );
      })}
    </Stack>
  );
}

function Placeholder({ title, detail }: { title: string; detail: string }) {
  return (
    <Stack spacing={2}>
      <Box
        sx={{
          p: 2,
          borderRadius: 3,
          bgcolor: 'action.hover',
          border: (t) => `1px dashed ${t.palette.divider}`,
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {detail}
        </Typography>
      </Box>
      <Divider />
      <Typography variant="body2" color="text.secondary">
        This section is visible in the settings navigation so the UI no longer looks empty while the
        backend contract is completed.
      </Typography>
    </Stack>
  );
}

export default SettingsPage;
