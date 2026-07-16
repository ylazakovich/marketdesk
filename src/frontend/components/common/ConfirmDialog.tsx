// Confirmation dialog for destructive / high-impact actions.
import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  alternateLabel?: string;
  confirmColor?: 'primary' | 'error' | 'warning' | 'success';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onAlternate?: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  alternateLabel,
  confirmColor = 'primary',
  loading = false,
  onConfirm,
  onCancel,
  onAlternate,
}) => {
  const messageId = React.useId();
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      aria-describedby={message ? messageId : undefined}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      {message && (
        <DialogContent>
          <Typography id={messageId} variant="body2" color="text.secondary">
            {message}
          </Typography>
        </DialogContent>
      )}
      <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onCancel} color="inherit" disabled={loading}>
          {cancelLabel}
        </Button>
        {alternateLabel && onAlternate && (
          <Button onClick={onAlternate} variant="outlined" disabled={loading}>
            {alternateLabel}
          </Button>
        )}
        <Button onClick={onConfirm} variant="contained" color={confirmColor} disabled={loading}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
