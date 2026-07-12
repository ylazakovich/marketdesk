// Workspace settings: profile (name/currency/timezone), Hermes autonomy tier,
// appearance (theme), and notification preferences.
import React, { useState } from 'react';
import {
  Box,
  Button,
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
import type { AutonomyLevel, Workspace } from '@shared/types';
import { AUTONOMY_LEVEL_LIST } from '@shared/constants';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { setWorkspace, setAutonomyLevel } from '../state/slices/workspaceSlice.js';
import type { WorkspaceState } from '../state/slices/workspaceSlice.js';
import { setThemeMode, enqueueToast } from '../state/slices/uiSlice.js';
import { useUpdateWorkspace } from '../services/hooks/index.js';
import { AUTONOMY_LABELS, AUTONOMY_DESCRIPTIONS } from '../utils/labels.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { Card } from '../components/common/Card.js';

const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CZK', 'UAH'];

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

const SettingsPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const workspace = useAppSelector((s) => s.workspace);
  const themeMode = useAppSelector((s) => s.ui.themeMode);

  const [name, setName] = useState(workspace.name);
  const [currency, setCurrency] = useState(workspace.currency);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [hermesNotifications, setHermesNotifications] = useState(true);

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

  return (
    <Box>
      <PageHeader title="Settings" subtitle="Manage your workspace, automation, and preferences." />

      <Stack spacing={2.5} sx={{ maxWidth: 860 }}>
        <Card title="Workspace" subtitle="General workspace details">
          <Stack spacing={2}>
            <TextField
              label="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)} fullWidth>
                {CURRENCIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </Select>
              <TextField
                label="Timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                fullWidth
              />
            </Stack>
            <Box>
              <Button variant="contained" onClick={handleSaveProfile} disabled={!dirty || saving}>
                Save changes
              </Button>
            </Box>
          </Stack>
        </Card>

        <Card
          title="Hermes autonomy"
          subtitle="Control how much the AI agent can do on its own"
        >
          <Stack spacing={1.5}>
            {AUTONOMY_LEVEL_LIST.map((level) => {
              const selected = workspace.autonomyLevel === level;
              return (
                <Box
                  key={level}
                  onClick={() => handleAutonomy(level)}
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    cursor: 'pointer',
                    border: (t) =>
                      `2px solid ${selected ? t.palette.primary.main : t.palette.divider}`,
                    bgcolor: selected ? 'action.selected' : 'transparent',
                    transition: 'border-color 120ms ease',
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {AUTONOMY_LABELS[level]}
                    </Typography>
                    {selected && (
                      <CheckCircleIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {AUTONOMY_DESCRIPTIONS[level]}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        </Card>

        <Card title="Appearance">
          <FormControlLabel
            control={
              <Switch
                checked={themeMode === 'dark'}
                onChange={(e) => dispatch(setThemeMode(e.target.checked ? 'dark' : 'light'))}
              />
            }
            label="Dark mode"
          />
        </Card>

        <Card title="Notifications">
          <Stack divider={<Divider />}>
            <FormControlLabel
              sx={{ py: 0.5, justifyContent: 'space-between', ml: 0 }}
              labelPlacement="start"
              control={
                <Switch
                  checked={emailNotifications}
                  onChange={(e) => setEmailNotifications(e.target.checked)}
                />
              }
              label="Email notifications"
            />
            <FormControlLabel
              sx={{ py: 0.5, justifyContent: 'space-between', ml: 0 }}
              labelPlacement="start"
              control={
                <Switch
                  checked={hermesNotifications}
                  onChange={(e) => setHermesNotifications(e.target.checked)}
                />
              }
              label="Hermes suggestion alerts"
            />
          </Stack>
        </Card>
      </Stack>
    </Box>
  );
};

export default SettingsPage;
