// Login page: minimal email/password form. On success stores credentials and
// seeds the workspace context, then navigates to the dashboard.
import React, { useState } from 'react';
import { Box, Button, Card, Stack, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { User } from '@shared/types';
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, AUTONOMY_LEVELS } from '@shared/constants';
import { useLogin, useRegister } from '../services/hooks/index.js';
import { useAppDispatch } from '../state/hooks.js';
import { setCredentials } from '../state/slices/authSlice.js';
import { setWorkspace } from '../state/slices/workspaceSlice.js';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? fallback;
  }
  return fallback;
}

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [login, { isLoading }] = useLogin();
  const [register, { isLoading: isRegistering }] = useRegister();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [isRegistration, setIsRegistration] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isRegistration && password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    const trimmedWorkspaceName = workspaceName.trim();
    try {
      const result = isRegistration
        ? register({ email, password, workspaceName: trimmedWorkspaceName || undefined })
        : login({ email, password });
      const { token, user: apiUser } = await result.unwrap();
      const user: User = {
        id: apiUser.id,
        email: apiUser.email,
        workspaceId: apiUser.workspaceId,
        createdAt: new Date().toISOString(),
      };
      dispatch(setCredentials({ token, user }));
      if (user.workspaceId) {
        dispatch(
          setWorkspace({
            id: user.workspaceId,
            name: isRegistration ? trimmedWorkspaceName : '',
            currency: DEFAULT_CURRENCY,
            timezone: DEFAULT_TIMEZONE,
            autonomyLevel: AUTONOMY_LEVELS.SUGGEST_ONLY,
          }),
        );
      }
      navigate('/');
    } catch (err) {
      setError(errorMessage(err, isRegistration ? 'Registration failed' : 'Login failed'));
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ p: 4, width: '100%', maxWidth: 400 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
          {isRegistration ? 'Create account' : 'Sign in'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {isRegistration ? 'Create your MarketDesk workspace.' : 'Welcome back to MarketDesk.'}
        </Typography>
        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              fullWidth
              required
            />
            {isRegistration && (
              <TextField
                label="Workspace name"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                autoComplete="organization"
                fullWidth
              />
            )}
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegistration ? 'new-password' : 'current-password'}
              fullWidth
              required
              inputProps={{ minLength: isRegistration ? 8 : undefined }}
              helperText={isRegistration ? 'At least 8 characters' : undefined}
            />
            {error && (
              <Typography variant="body2" color="error.main">
                {error}
              </Typography>
            )}
            <Button type="submit" variant="contained" size="large" disabled={isLoading || isRegistering} fullWidth>
              {isRegistration ? 'Create account' : 'Sign in'}
            </Button>
            <Button
              type="button"
              variant="text"
              onClick={() => {
                setIsRegistration((value) => !value);
                setError(null);
              }}
              disabled={isLoading || isRegistering}
            >
              {isRegistration ? 'Already have an account? Sign in' : 'Create an account'}
            </Button>
          </Stack>
        </form>
      </Card>
    </Box>
  );
};

export default LoginPage;
