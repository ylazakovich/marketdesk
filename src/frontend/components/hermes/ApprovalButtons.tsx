// Approve / Dismiss controls for a Hermes event.
// - Enabled only while the event is pending_review (domain rule).
// - Critical-severity approvals require an extra confirmation step.
// - Success/error surfaced via uiSlice toasts.
import React, { useState } from 'react';
import { Button, Stack } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import type { HermesEvent } from '@shared/types';
import {
  useApproveHermesEvent,
  useDismissHermesEvent,
} from '../../services/hooks/index.js';
import { useAppDispatch } from '../../state/hooks.js';
import { enqueueToast } from '../../state/slices/uiSlice.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';

export interface ApprovalButtonsProps {
  event: HermesEvent;
  size?: 'small' | 'medium';
  onResolved?: () => void;
  approveLabel?: string;
  successMessage?: string;
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Action failed';
  }
  return 'Action failed';
}

export const ApprovalButtons: React.FC<ApprovalButtonsProps> = ({
  event,
  size = 'small',
  onResolved,
  approveLabel = 'Approve',
  successMessage = 'Suggestion approved and applied.',
}) => {
  const dispatch = useAppDispatch();
  const [approve, { isLoading: approving }] = useApproveHermesEvent();
  const [dismiss, { isLoading: dismissing }] = useDismissHermesEvent();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const pending = event.status === 'pending_review';
  const busy = approving || dismissing;

  const runApprove = async () => {
    setConfirmOpen(false);
    try {
      await approve(event.id).unwrap();
      dispatch(enqueueToast({ message: successMessage, severity: 'success' }));
      onResolved?.();
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleApproveClick = () => {
    if (event.severity === 'critical') {
      setConfirmOpen(true);
      return;
    }
    void runApprove();
  };

  const handleDismiss = async () => {
    try {
      await dismiss(event.id).unwrap();
      dispatch(enqueueToast({ message: 'Suggestion dismissed.', severity: 'info' }));
      onResolved?.();
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  return (
    <>
      <Stack direction="row" spacing={1}>
        <Button
          size={size}
          variant="contained"
          color="primary"
          startIcon={<CheckIcon />}
          disabled={!pending || busy}
          onClick={handleApproveClick}
        >
          {approveLabel}
        </Button>
        <Button
          size={size}
          variant="outlined"
          color="inherit"
          startIcon={<CloseIcon />}
          disabled={!pending || busy}
          onClick={handleDismiss}
        >
          Dismiss
        </Button>
      </Stack>

      <ConfirmDialog
        open={confirmOpen}
        title="Approve critical change?"
        message="This is a high-impact change flagged as critical. Approving will apply it immediately across the affected listings."
        confirmLabel="Approve change"
        confirmColor="error"
        loading={approving}
        onConfirm={runApprove}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
};

export default ApprovalButtons;
