// Generic dialog wrapper with title bar, close button, and an actions slot.
import React from 'react';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import type { Breakpoint } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: Breakpoint | false;
  fullWidth?: boolean;
  dividers?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  maxWidth = 'sm',
  fullWidth = true,
  dividers = true,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth={fullWidth}>
    {(title || subtitle) && (
      <DialogTitle component="div" sx={{ pr: 6 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
          <div>
            {title && (
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            )}
          </div>
        </Stack>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ position: 'absolute', right: 12, top: 12, color: 'text.secondary' }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
    )}
    <DialogContent dividers={dividers}>{children}</DialogContent>
    {actions && <DialogActions sx={{ px: 3, py: 2 }}>{actions}</DialogActions>}
  </Dialog>
);

export default Modal;
