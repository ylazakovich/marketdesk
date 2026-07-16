import React, { useState } from 'react';
import { Alert, Checkbox, FormControlLabel } from '@mui/material';
import type { ProductFormValues } from './productFormModel';

type BelowCostConfirmationAlertProps = {
  warning: string;
  confirmed: boolean;
  hasError: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
};

export const BelowCostConfirmationAlert: React.FC<BelowCostConfirmationAlertProps> = ({
  warning,
  confirmed,
  hasError,
  onConfirmedChange,
}) => (
  <Alert severity={hasError ? 'error' : 'warning'}>
    {warning}
    <FormControlLabel
      control={
        <Checkbox
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
        />
      }
      label="I confirm this product may be sold below cost."
    />
  </Alert>
);

export function useBelowCostConfirmation() {
  const [confirmed, setConfirmed] = useState(false);
  const [hasError, setHasError] = useState(false);

  const resetForField = (field: keyof ProductFormValues) => {
    if (field === 'costPrice' || field === 'sellingPrice') {
      setConfirmed(false);
      setHasError(false);
    }
  };

  const changeConfirmed = (value: boolean) => {
    setConfirmed(value);
    setHasError(false);
  };

  return {
    confirmed,
    hasError,
    setHasError,
    resetForField,
    changeConfirmed,
  };
}
