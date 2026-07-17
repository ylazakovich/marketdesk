// Workspace settings: visual settings shell with section navigation for general
// preferences, Hermes autonomy, notifications, integrations, appearance, and security.
import React, { useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
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
import type { AutonomyLevel, Workspace } from '@shared/types';
import { AUTONOMY_LEVEL_LIST } from '@shared/constants';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { setWorkspace, setAutonomyLevel } from '../state/slices/workspaceSlice.js';
import type { WorkspaceState } from '../state/slices/workspaceSlice.js';
import { setThemeMode, enqueueToast } from '../state/slices/uiSlice.js';
import { useApplicationInfo, useUpdateWorkspace } from '../services/hooks/index.js';
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

export const settingsSections: Array<{ id: SettingsSection; label: string; caption: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', caption: 'Workspace basics', icon: <TuneIcon fontSize="small" /> },
  { id: 'hermes', label: 'Hermes AI', caption: 'Autonomy and automation', icon: <AutoAwesomeIcon fontSize="small" /> },
  { id: 'notifications', label: 'Notifications', caption: 'Channels by event', icon: <NotificationsIcon fontSize="small" /> },
  { id: 'marketplaces', label: 'Marketplace Accounts', caption: 'Seller account health', icon: <StorefrontIcon fontSize="small" /> },
  { id: 'apiKeys', label: 'API Keys', caption: 'Programmatic access', icon: <KeyIcon fontSize="small" /> },
  { id: 'appearance', label: 'Appearance', caption: 'Theme and density', icon: <PaletteIcon fontSize="small" /> },
  { id: 'telegram', label: 'Telegram', caption: 'Bot notifications', icon: <TelegramIcon fontSize="small" /> },
  { id: 'security', label: 'Security', caption: 'Account protection', icon: <SecurityIcon fontSize="small" /> },
  { id: 'about', label: 'About', caption: 'Application information', icon: <InfoIcon fontSize="small" /> },
];

const notificationRows = [
  'New sale',
  'Competitor price change',
  'Listing needs attention',
  'Sync errors',
  'Weekly performance report',
];

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

function toWorkspaceState(ws: Workspace): WorkspaceState {
  return {
    id: ws.id,
    name: ws.name,
    currency: ws.currency,
    timezone: ws.timezone,
    autonomyLevel: ws.autonomyLevel,
  };
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
  const themeMode = useAppSelector((s) => s.ui.themeMode);
  const {
    data: applicationInfo,
    isLoading: applicationInfoLoading,
    isError: applicationInfoError,
  } = useApplicationInfo();

  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [name, setName] = useState(workspace.name);
  const [currency, setCurrency] = useState(workspace.currency);
  const [timezone, setTimezone] = useState(workspace.timezone);

  const [updateWorkspace, { isLoading: saving }] = useUpdateWorkspace();
  const dirty =
    name !== workspace.name || currency !== workspace.currency || timezone !== workspace.timezone;

  const handleSaveProfile = async () => {
    if (!workspace.id) {
      dispatch(setWorkspace({ ...workspace, name, currency, timezone }));
      dispatch(enqueueToast({ message: 'Workspace settings saved.', severity: 'success' }));
      return;
    }
    try {
      const updated = await updateWorkspace({
        id: workspace.id,
        patch: { name, currency, timezone },
      }).unwrap();
      dispatch(setWorkspace(toWorkspaceState(updated)));
      dispatch(enqueueToast({ message: 'Workspace settings saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleAutonomy = async (level: AutonomyLevel) => {
    if (!workspace.id) {
      dispatch(setAutonomyLevel(level));
      dispatch(
        enqueueToast({ message: `Autonomy set to ${AUTONOMY_LABELS[level]}.`, severity: 'success' }),
      );
      return;
    }
    try {
      const updated = await updateWorkspace({
        id: workspace.id,
        patch: { autonomyLevel: level },
      }).unwrap();
      dispatch(setWorkspace(toWorkspaceState(updated)));
      dispatch(
        enqueueToast({ message: `Autonomy set to ${AUTONOMY_LABELS[level]}.`, severity: 'success' }),
      );
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return (
          <Stack spacing={2.25}>
            <TextField label="Workspace name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)} fullWidth aria-label="Default currency">
                {CURRENCIES.map((c) => (
                  <MenuItem key={c} value={c}>{c} — {c === 'PLN' ? 'Polish złoty' : c}</MenuItem>
                ))}
              </Select>
              <TextField label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} fullWidth />
            </Stack>
            <TextField
              label="Language"
              value="English"
              fullWidth
              disabled
              helperText="Language preferences are coming soon and are not saved yet."
            />
            <Stack direction="row" spacing={1.5} justifyContent="flex-end">
              <Button
                variant="outlined"
                onClick={() => {
                  setName(workspace.name);
                  setCurrency(workspace.currency);
                  setTimezone(workspace.timezone);
                }}
              >
                Cancel
              </Button>
              <Button variant="contained" onClick={handleSaveProfile} disabled={!dirty || saving}>
                Save changes
              </Button>
            </Stack>
          </Stack>
        );
      case 'hermes':
        return (
          <Stack spacing={1.5}>
            {AUTONOMY_LEVEL_LIST.map((level) => {
              const selected = workspace.autonomyLevel === level;
              return (
                <ButtonBase
                  key={level}
                  onClick={() => handleAutonomy(level)}
                  aria-pressed={selected}
                  sx={{
                    p: 2,
                    borderRadius: 2.5,
                    width: '100%',
                    display: 'block',
                    textAlign: 'left',
                    border: (t) => `2px solid ${selected ? t.palette.primary.main : t.palette.divider}`,
                    bgcolor: selected ? 'action.selected' : 'background.paper',
                  }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{AUTONOMY_LABELS[level]}</Typography>
                    {selected && <CheckCircleIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">{AUTONOMY_DESCRIPTIONS[level]}</Typography>
                </ButtonBase>
              );
            })}
          </Stack>
        );
      case 'notifications':
        return (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Per-event notification delivery is coming soon. The matrix is read-only until the backend can persist each event and channel independently.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr auto' }, gap: 1, alignItems: 'center' }}>
              {notificationRows.map((row) => (
                <React.Fragment key={row}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{row}</Typography>
                  <Chip size="small" label="Not configurable yet" variant="outlined" />
                </React.Fragment>
              ))}
            </Box>
          </Stack>
        );
      case 'appearance':
        return (
          <Stack spacing={2}>
            <FormControlLabel
              control={<Switch checked={themeMode === 'dark'} onChange={(e) => dispatch(setThemeMode(e.target.checked ? 'dark' : 'light'))} />}
              label="Dark mode"
            />
            <Chip label="Density controls coming next" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
          </Stack>
        );
      case 'marketplaces':
        return <Placeholder title="Marketplace account management" detail="Connect, reconnect, and inspect seller account health without exposing tokens." />;
      case 'apiKeys':
        return <Placeholder title="API key management" detail="List masked keys, generate one-time secrets, and revoke stale access." />;
      case 'telegram':
        return <Placeholder title="Telegram integration" detail="Configure bot username, chat ID, and Telegram delivery preferences." />;
      case 'security':
        return <Placeholder title="Security controls" detail="Password, two-factor authentication, and active sessions belong here." />;
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

  const activeMeta = settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];
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
          <SettingsSectionNavigation activeSection={activeSection} onSectionChange={setActiveSection} />
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
            sx={{ justifyContent: 'flex-start', textTransform: 'none', borderRadius: 2, py: 1.1 }}
          >
            <Box sx={{ textAlign: 'left', minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>{section.label}</Typography>
              <Typography variant="caption" sx={{ opacity: active ? 0.9 : 0.68 }} noWrap>{section.caption}</Typography>
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
      <Box sx={{ p: 2, borderRadius: 3, bgcolor: 'action.hover', border: (t) => `1px dashed ${t.palette.divider}` }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{detail}</Typography>
      </Box>
      <Divider />
      <Typography variant="body2" color="text.secondary">
        This section is visible in the settings navigation so the UI no longer looks empty while the backend contract is completed.
      </Typography>
    </Stack>
  );
}

export default SettingsPage;
