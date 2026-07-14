// Single-page product create/edit form. Owns local field state + validation;
// the parent supplies onSubmit (wired to a create/update mutation) and busy flag.
import React, { useMemo, useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import type { Product } from '@shared/types';
import {
  emptyProductValues,
  marginWarning,
  productToValues,
  toProductSubmissionValues,
  validateProductValues,
} from './productFormModel.js';
import type { ProductFormValues, ProductFieldErrors, ProductSubmissionValues } from './productFormModel.js';
import {
  DescriptionTagsFields,
  ImagesField,
  NameSkuFields,
  PriceFields,
  StatusField,
} from './ProductFields.js';

export interface ProductFormProps {
  initial?: Product;
  submitting?: boolean;
  onSubmit: (values: ProductSubmissionValues) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

export const ProductForm: React.FC<ProductFormProps> = ({
  initial,
  submitting = false,
  onSubmit,
  onCancel,
  submitLabel,
}) => {
  const [values, setValues] = useState<ProductFormValues>(() =>
    initial ? productToValues(initial) : emptyProductValues(),
  );
  const [errors, setErrors] = useState<ProductFieldErrors>({});

  const change = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const warning = useMemo(() => marginWarning(values), [values]);
  const fieldProps = { values, errors, onChange: change };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateProductValues(values);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    onSubmit(toProductSubmissionValues(values));
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack spacing={2.5}>
        <NameSkuFields {...fieldProps} />
        <DescriptionTagsFields {...fieldProps} />
        <PriceFields {...fieldProps} />
        {warning && <Alert severity="warning">{warning}</Alert>}
        <StatusField {...fieldProps} />
        <ImagesField {...fieldProps} />

        <Stack direction="row" spacing={1.5} justifyContent="flex-end">
          {onCancel && (
            <Button type="button" color="inherit" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitLabel ?? (initial ? 'Save changes' : 'Create product')}
          </Button>
        </Stack>
      </Stack>
    </form>
  );
};

export default ProductForm;
