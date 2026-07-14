// Multi-step product creation wizard. Reuses the shared field controls and
// validation model; emits the completed values via onSubmit on the final step.
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import {
  emptyProductValues,
  marginWarning,
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

export interface ProductWizardFormProps {
  submitting?: boolean;
  onSubmit: (values: ProductSubmissionValues) => void;
  onCancel?: () => void;
}

const STEPS = ['Basics', 'Details', 'Pricing', 'Media & review'] as const;

// Which value keys each step is responsible for (drives per-step validation).
const STEP_FIELDS: Array<Array<keyof ProductFormValues>> = [
  ['name', 'sku'],
  ['description'],
  ['costPrice', 'sellingPrice'],
  [],
];

export const ProductWizardForm: React.FC<ProductWizardFormProps> = ({
  submitting = false,
  onSubmit,
  onCancel,
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [values, setValues] = useState<ProductFormValues>(() => emptyProductValues());
  const [errors, setErrors] = useState<ProductFieldErrors>({});

  const change = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const warning = useMemo(() => marginWarning(values), [values]);
  const fieldProps = { values, errors, onChange: change };

  const validateStep = (step: number): boolean => {
    const all = validateProductValues(values);
    const stepErrors: ProductFieldErrors = {};
    for (const key of STEP_FIELDS[step]) {
      if (all[key]) stepErrors[key] = all[key];
    }
    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  };

  const handleNext = () => {
    if (!validateStep(activeStep)) return;
    setActiveStep((s) => s + 1);
  };

  const handleBack = () => {
    setErrors({});
    setActiveStep((s) => Math.max(0, s - 1));
  };

  const handleFinish = () => {
    const all = validateProductValues(values);
    setErrors(all);
    if (Object.keys(all).length > 0) {
      // Jump back to the earliest step with an error.
      const firstBad = STEP_FIELDS.findIndex((fields) => fields.some((f) => all[f]));
      if (firstBad >= 0) setActiveStep(firstBad);
      return;
    }
    onSubmit(toProductSubmissionValues(values));
  };

  return (
    <Stack spacing={3}>
      <Stepper activeStep={activeStep} alternativeLabel>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ minHeight: 220 }}>
        {activeStep === 0 && <NameSkuFields {...fieldProps} />}
        {activeStep === 1 && <DescriptionTagsFields {...fieldProps} />}
        {activeStep === 2 && (
          <Stack spacing={2}>
            <PriceFields {...fieldProps} />
            {warning && <Alert severity="warning">{warning}</Alert>}
          </Stack>
        )}
        {activeStep === 3 && (
          <Stack spacing={2}>
            <StatusField {...fieldProps} />
            <ImagesField {...fieldProps} />
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {values.name || 'Untitled product'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {values.sku || 'no-sku'} · {values.category || 'Uncategorised'} · {values.tags.length}{' '}
                tag(s) · {values.images.length} image(s)
              </Typography>
            </Box>
          </Stack>
        )}
      </Box>

      <Stack direction="row" spacing={1.5} justifyContent="space-between">
        <Button type="button" color="inherit" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Stack direction="row" spacing={1.5}>
          <Button type="button" onClick={handleBack} disabled={activeStep === 0 || submitting}>
            Back
          </Button>
          {activeStep < STEPS.length - 1 ? (
            <Button type="button" variant="contained" onClick={handleNext}>
              Next
            </Button>
          ) : (
            <Button type="button" variant="contained" onClick={handleFinish} disabled={submitting}>
              Create product
            </Button>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
};

export default ProductWizardForm;
