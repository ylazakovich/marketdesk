// Renders the uiSlice toast queue as stacked, auto-dismissing snackbars.
// Mount once near the app root (see App.tsx).
import React from 'react';
import { Alert, Snackbar, Stack } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import { dismissToast } from '../../state/slices/uiSlice.js';

export const Toast: React.FC = () => {
  const toasts = useAppSelector((state) => state.ui.toasts);
  const dispatch = useAppDispatch();

  if (toasts.length === 0) return null;

  return (
    <Stack
      spacing={1}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: (theme) => theme.zIndex.snackbar,
        maxWidth: 400,
      }}
    >
      {toasts.map((toast) => (
        <Snackbar
          key={toast.id}
          open
          autoHideDuration={toast.autoHideMs}
          onClose={(_event, reason) => {
            if (reason === 'clickaway') return;
            dispatch(dismissToast(toast.id));
          }}
          sx={{ position: 'static', transform: 'none' }}
        >
          <Alert
            severity={toast.severity}
            variant="filled"
            onClose={() => dispatch(dismissToast(toast.id))}
            sx={{ width: '100%' }}
          >
            {toast.message}
          </Alert>
        </Snackbar>
      ))}
    </Stack>
  );
};

export default Toast;
