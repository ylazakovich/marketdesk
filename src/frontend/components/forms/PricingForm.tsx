// Compact price editor for a single listing (used on the listing detail page).
import React, { useMemo, useState } from 'react';
import { Alert, Button, InputAdornment, Stack, TextField, Typography } from '@mui/material';

export interface PricingFormProps {
  currentPrice: number;
  costPrice?: number;
  currency: string;
  submitting?: boolean;
  onSubmit: (price: number) => void;
}

export const PricingForm: React.FC<PricingFormProps> = ({
  currentPrice,
  costPrice,
  currency,
  submitting = false,
  onSubmit,
}) => {
  const [price, setPrice] = useState<string>(String(currentPrice));

  const parsed = price.trim() === '' ? NaN : Number(price);
  const invalid = Number.isNaN(parsed) || parsed < 0;
  const unchanged = parsed === currentPrice;

  const belowCost = useMemo(
    () => typeof costPrice === 'number' && !invalid && parsed < costPrice,
    [parsed, costPrice, invalid],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid || unchanged) return;
    onSubmit(parsed);
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <TextField
          label="New price"
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={invalid}
          helperText={invalid ? 'Enter a non-negative price.' : `Currency: ${currency}`}
          InputProps={{
            startAdornment: <InputAdornment position="start">{currency}</InputAdornment>,
          }}
          inputProps={{ min: 0, step: '0.01' }}
          fullWidth
        />
        {belowCost && (
          <Alert severity="warning">
            This price is below the product&apos;s cost — the listing would sell at a loss.
          </Alert>
        )}
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="caption" color="text.secondary">
            Current: {currency} {currentPrice}
          </Typography>
          <Button type="submit" variant="contained" disabled={submitting || invalid || unchanged}>
            Update price
          </Button>
        </Stack>
      </Stack>
    </form>
  );
};

export default PricingForm;
