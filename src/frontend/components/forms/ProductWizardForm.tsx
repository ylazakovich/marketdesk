// Multi-step product creation wizard. Reuses the shared field controls and
// validation model; emits the completed values via onSubmit on the final step.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Chip,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import type {
  Marketplace,
  MarketplaceKey,
  ProductAIDraft,
  ProductAIDraftRequest,
} from '@shared/types';
import {
  emptyProductValues,
  marginWarning,
  toProductSubmissionValues,
  validateProductValues,
} from './productFormModel.js';
import type {
  ProductFormValues,
  ProductFieldErrors,
  ProductSubmissionValues,
} from './productFormModel.js';
import {
  DescriptionTagsFields,
  ImagesField,
  NameSkuFields,
  PriceFields,
  StatusField,
} from './ProductFields.js';

export interface ProductWizardFormProps {
  submitting?: boolean;
  marketplaces?: Marketplace[];
  marketplacesLoading?: boolean;
  marketplacesError?: boolean;
  onSubmit: (values: ProductSubmissionValues) => void;
  onCancel?: () => void;
  onGenerateAIDraft?: (request: ProductAIDraftRequest) => Promise<ProductAIDraft>;
}

const STEPS = ['Photos', 'Basic info', 'Pricing', 'Category', 'Marketplaces', 'Review'] as const;

// Which value keys each step is responsible for (drives per-step validation).
const STEP_FIELDS: Array<Array<keyof ProductFormValues>> = [
  ['images'],
  ['name', 'sku', 'description'],
  ['costPrice', 'sellingPrice'],
  ['category'],
  [],
  [],
];

const MARKETPLACE_OPTIONS: ReadonlyArray<{ key: MarketplaceKey; name: string }> = [
  { key: 'olx', name: 'OLX' },
  { key: 'allegro', name: 'Allegro' },
  { key: 'vinted', name: 'Vinted' },
  { key: 'facebook', name: 'Facebook Marketplace' },
  { key: 'ebay', name: 'eBay' },
  { key: 'etsy', name: 'Etsy' },
  { key: 'amazon', name: 'Amazon' },
];

export interface WizardMarketplaceOption {
  key: MarketplaceKey;
  name: string;
  connected: boolean;
  configured: boolean;
}

export interface WizardStepValidation {
  fieldErrors: ProductFieldErrors;
  marketplaceError?: string;
}

export interface MarketplaceReadinessStatus {
  connected: boolean;
  marketplaceId: string;
  providerKey: MarketplaceKey;
}

export interface VerifiedMarketplaceResult {
  marketplaces: Marketplace[];
  hadCheckError: boolean;
}

export async function verifyWizardMarketplaceReadiness(
  marketplaces: Marketplace[],
  check: (id: string) => Promise<MarketplaceReadinessStatus>
): Promise<VerifiedMarketplaceResult> {
  let hadCheckError = false;
  const verified = await Promise.all(
    marketplaces.map(async (marketplace) => {
      if (!marketplace.connected) return marketplace;
      try {
        const status = await check(marketplace.id);
        const connected =
          status.connected &&
          status.marketplaceId === marketplace.id &&
          status.providerKey === marketplace.key;
        return { ...marketplace, connected };
      } catch {
        hadCheckError = true;
        return { ...marketplace, connected: false };
      }
    })
  );
  return { marketplaces: verified, hadCheckError };
}

export function buildWizardMarketplaceOptions(
  marketplaces: Marketplace[] | undefined
): WizardMarketplaceOption[] {
  const byKey = new Map((marketplaces ?? []).map((marketplace) => [marketplace.key, marketplace]));
  return MARKETPLACE_OPTIONS.map((option) => {
    const configured = byKey.get(option.key);
    return {
      ...option,
      connected: configured?.connected === true,
      configured: configured !== undefined,
    };
  });
}

export function validateWizardStep(
  step: number,
  values: ProductFormValues,
  targetMarketplace: MarketplaceKey | null,
  marketplaces: Marketplace[] | undefined,
  marketplacesLoading = false,
  marketplacesError = false
): WizardStepValidation {
  const all = validateProductValues(values);
  const validImages = values.images.filter((image) => image.trim().length > 0);
  if (validImages.length !== values.images.length) {
    all.images = 'Remove blank product photos.';
  } else if (validImages.length === 0) {
    all.images = 'Add at least one product photo.';
  } else if (validImages.length > 12) {
    all.images = 'Add no more than 12 product photos.';
  }
  if (!values.category.trim()) all.category = 'Choose a category.';

  const fieldErrors: ProductFieldErrors = {};
  for (const key of STEP_FIELDS[step] ?? []) {
    if (all[key]) fieldErrors[key] = all[key];
  }

  if (step !== 4) return { fieldErrors };
  if (marketplacesLoading) {
    return { fieldErrors, marketplaceError: 'Wait for marketplace connections to load.' };
  }
  if (marketplacesError) {
    return {
      fieldErrors,
      marketplaceError: 'Marketplace connections could not be loaded. Retry before continuing.',
    };
  }

  const connectedKeys = new Set(
    (marketplaces ?? [])
      .filter((marketplace) => marketplace.connected)
      .map((marketplace) => marketplace.key)
  );
  if (connectedKeys.size === 0) {
    return {
      fieldErrors,
      marketplaceError: 'Connect at least one marketplace before continuing.',
    };
  }
  if (!targetMarketplace || !connectedKeys.has(targetMarketplace)) {
    return { fieldErrors, marketplaceError: 'Select a connected marketplace.' };
  }
  return { fieldErrors };
}

const DRAFT_FIELD_ORDER: Array<keyof ProductFormValues> = [
  'name',
  'sku',
  'description',
  'category',
  'condition',
  'tags',
  'images',
  'costPrice',
  'sellingPrice',
  'status',
];

function populatedValues(values: ProductFormValues): ProductAIDraftRequest['existingFields'] {
  return {
    name: values.name || undefined,
    sku: values.sku || undefined,
    description: values.description || undefined,
    category: values.category || undefined,
    condition: values.condition,
    status: values.status,
    costPrice: values.costPrice,
    sellingPrice: values.sellingPrice,
    tags: values.tags,
    images: values.images,
  };
}

function fieldSummary(value: ProductFormValues[keyof ProductFormValues]): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export const ProductWizardForm: React.FC<ProductWizardFormProps> = ({
  submitting = false,
  marketplaces,
  marketplacesLoading = false,
  marketplacesError = false,
  onSubmit,
  onCancel,
  onGenerateAIDraft,
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [values, setValues] = useState<ProductFormValues>(() => emptyProductValues());
  const [errors, setErrors] = useState<ProductFieldErrors>({});
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductAIDraft | null>(null);
  const [selectedDraftFields, setSelectedDraftFields] = useState<Array<keyof ProductFormValues>>(
    []
  );
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [targetMarketplace, setTargetMarketplace] = useState<MarketplaceKey | null>(null);
  const marketplaceOptions = useMemo(
    () => buildWizardMarketplaceOptions(marketplaces),
    [marketplaces]
  );

  useEffect(() => {
    if (
      targetMarketplace &&
      !marketplaces?.some(
        (marketplace) => marketplace.key === targetMarketplace && marketplace.connected
      )
    ) {
      setTargetMarketplace(null);
    }
  }, [marketplaces, targetMarketplace]);

  const change = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const warning = useMemo(() => marginWarning(values), [values]);
  const fieldProps = { values, errors, onChange: change };

  const validationFor = (step: number) =>
    validateWizardStep(
      step,
      values,
      targetMarketplace,
      marketplaces,
      marketplacesLoading,
      marketplacesError
    );

  const validateStep = (step: number): boolean => {
    const validation = validationFor(step);
    setErrors(validation.fieldErrors);
    setMarketplaceError(validation.marketplaceError ?? null);
    return Object.keys(validation.fieldErrors).length === 0 && !validation.marketplaceError;
  };

  const requestDraft = async (mode: ProductAIDraftRequest['mode']) => {
    if (!onGenerateAIDraft) return;
    setDraftError(null);
    setDraftLoading(true);
    try {
      const nextDraft = await onGenerateAIDraft({
        mode,
        title: values.name || undefined,
        imageUrls: values.images,
        existingFields: populatedValues(values),
      });
      setDraft(nextDraft);
      setSelectedDraftFields(
        DRAFT_FIELD_ORDER.filter((field) => nextDraft.fields[field] !== undefined)
      );
    } catch (err) {
      const e = err as { data?: { error?: { message?: string } }; message?: string };
      setDraftError(e.data?.error?.message ?? e.message ?? 'AI draft generation failed.');
    } finally {
      setDraftLoading(false);
    }
  };

  const applyDraft = (fields: Array<keyof ProductFormValues>) => {
    if (!draft) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        const value = draft.fields[field];
        if (value !== undefined) {
          (next as Record<keyof ProductFormValues, ProductFormValues[keyof ProductFormValues]>)[
            field
          ] = value;
        }
      }
      return next;
    });
    setErrors({});
  };

  const handleNext = () => {
    if (!validateStep(activeStep)) return;
    setActiveStep((s) => s + 1);
  };

  const handleBack = () => {
    setErrors({});
    setMarketplaceError(null);
    setActiveStep((s) => Math.max(0, s - 1));
  };

  const handleFinish = () => {
    for (let step = 0; step <= 4; step += 1) {
      const validation = validationFor(step);
      if (Object.keys(validation.fieldErrors).length > 0 || validation.marketplaceError) {
        setErrors(validation.fieldErrors);
        setMarketplaceError(validation.marketplaceError ?? null);
        setActiveStep(step);
        return;
      }
    }
    onSubmit({
      ...toProductSubmissionValues(values),
      targetMarketplace: targetMarketplace ?? undefined,
    });
  };

  const availableDraftFields = draft
    ? DRAFT_FIELD_ORDER.filter((field) => draft.fields[field] !== undefined)
    : [];

  return (
    <Stack spacing={3}>
      <Stack spacing={1.5} sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <AutoAwesomeIcon color="primary" />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle2">AI-assisted product creation</Typography>
            <Typography variant="body2" color="text.secondary">
              Start from photos or a title, then review and apply the draft manually.
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            onClick={() => requestDraft('photos')}
            disabled={!onGenerateAIDraft || draftLoading || values.images.length === 0}
          >
            Create from photos
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => requestDraft('title')}
            disabled={!onGenerateAIDraft || draftLoading || !values.name.trim()}
          >
            Start with title
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Manual product entry remains available. AI drafts never save or publish until you apply
          fields and create the product.
        </Typography>
        {draftError && <Alert severity="error">{draftError}</Alert>}
        {draft && (
          <Stack spacing={1.5} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.paper' }}>
            <Typography variant="subtitle2">
              Draft from {draft.mode === 'photos' ? 'photos' : 'title'} · confidence{' '}
              {Math.round(draft.confidence * 100)}%
            </Typography>
            <Stack spacing={0.5}>
              {availableDraftFields.map((field) => (
                <FormControlLabel
                  key={field}
                  control={
                    <Checkbox
                      size="small"
                      checked={selectedDraftFields.includes(field)}
                      onChange={(event) => {
                        setSelectedDraftFields((prev) =>
                          event.target.checked ? [...prev, field] : prev.filter((f) => f !== field)
                        );
                      }}
                    />
                  }
                  label={`${field}: ${fieldSummary(draft.fields[field] as ProductFormValues[keyof ProductFormValues])}`}
                />
              ))}
            </Stack>
            {draft.uncertainFields.length > 0 && (
              <Alert severity="warning">
                Review uncertain fields: {draft.uncertainFields.join(', ')}.
              </Alert>
            )}
            {draft.missingInfoQuestions.length > 0 && (
              <Typography variant="body2" color="text.secondary">
                Missing info: {draft.missingInfoQuestions.join(' ')}
              </Typography>
            )}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant="contained"
                onClick={() => applyDraft(availableDraftFields)}
              >
                Apply
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => applyDraft(selectedDraftFields)}
              >
                Apply selected
              </Button>
              <Button size="small" onClick={() => requestDraft(draft.mode)} disabled={draftLoading}>
                Regenerate
              </Button>
              <Button size="small" color="inherit" onClick={() => setDraft(null)}>
                Discard
              </Button>
            </Stack>
          </Stack>
        )}
      </Stack>

      <Divider />

      <Stepper activeStep={activeStep} alternativeLabel>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ minHeight: 280 }}>
        {activeStep === 0 && (
          <Stack spacing={2}>
            <Typography variant="subtitle2">Upload photos</Typography>
            <ImagesField {...fieldProps} />
            <Typography variant="caption" color="text.secondary">
              Add up to 12 image URLs. The first image is treated as the cover and can be analyzed
              by Hermes.
            </Typography>
            {values.images.length > 0 && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {values.images.slice(0, 12).map((image, index) => (
                  <Box key={image + index} sx={{ position: 'relative' }}>
                    <Box
                      component="img"
                      src={image}
                      alt={`Product photo ${index + 1}`}
                      sx={{ width: 88, height: 88, borderRadius: 2, objectFit: 'cover' }}
                    />
                    {index === 0 && (
                      <Chip
                        size="small"
                        label="Cover"
                        sx={{ position: 'absolute', left: 6, top: 6 }}
                      />
                    )}
                  </Box>
                ))}
              </Stack>
            )}
          </Stack>
        )}
        {activeStep === 1 && (
          <Stack spacing={2}>
            <NameSkuFields {...fieldProps} showCategory={false} />
            <DescriptionTagsFields {...fieldProps} />
            <StatusField {...fieldProps} />
          </Stack>
        )}
        {activeStep === 2 && (
          <Stack spacing={2}>
            <PriceFields {...fieldProps} />
            <Alert severity="info">
              Hermes suggestion: compare similar OLX listings, keep a margin target, and adjust
              before publishing.
            </Alert>
            {warning && <Alert severity="warning">{warning}</Alert>}
          </Stack>
        )}
        {activeStep === 3 && (
          <FormControl error={Boolean(errors.category)}>
            <FormLabel id="product-category-label">Choose category</FormLabel>
            <ToggleButtonGroup
              exclusive
              value={values.category || null}
              onChange={(_event, category: string | null) => {
                if (category) change('category', category);
              }}
              aria-labelledby="product-category-label"
              aria-describedby={errors.category ? 'product-category-error' : undefined}
              sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}
            >
              {['Electronics', 'Fashion', 'Home and Garden', 'Sports', 'Kitchen', 'Other'].map(
                (category) => (
                  <ToggleButton
                    key={category}
                    value={category}
                    sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
                  >
                    {category}
                  </ToggleButton>
                )
              )}
            </ToggleButtonGroup>
            {errors.category && (
              <FormHelperText id="product-category-error">{errors.category}</FormHelperText>
            )}
            <Typography variant="caption" color="text.secondary">
              Hermes can suggest the closest category from photos, title, and description; final
              mapping stays editable.
            </Typography>
          </FormControl>
        )}
        {activeStep === 4 && (
          <FormControl error={Boolean(marketplaceError)}>
            <FormLabel id="target-marketplace-label">Marketplaces</FormLabel>
            {marketplacesLoading && <Alert severity="info">Loading marketplace connections…</Alert>}
            {marketplacesError && (
              <Alert severity="error">Marketplace connections could not be loaded.</Alert>
            )}
            <RadioGroup
              value={targetMarketplace ?? ''}
              onChange={(_event, key) => {
                setTargetMarketplace(key as MarketplaceKey);
                setMarketplaceError(null);
              }}
              aria-labelledby="target-marketplace-label"
              aria-describedby={marketplaceError ? 'target-marketplace-error' : undefined}
              sx={{ mt: 1, gap: 1 }}
            >
              {marketplaceOptions.map((marketplace) => {
                const selected = targetMarketplace === marketplace.key;
                return (
                  <FormControlLabel
                    key={marketplace.key}
                    value={marketplace.key}
                    disabled={!marketplace.connected}
                    control={<Radio />}
                    sx={{
                      m: 0,
                      p: 1.5,
                      borderRadius: 2,
                      opacity: marketplace.connected ? 1 : 0.62,
                      border: (t) =>
                        `2px solid ${selected ? t.palette.primary.main : t.palette.divider}`,
                      bgcolor: selected ? 'action.selected' : 'background.paper',
                    }}
                    label={
                      <Box sx={{ width: '100%' }}>
                        <Stack
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          spacing={1}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {marketplace.name}
                          </Typography>
                          {selected ? (
                            <Chip size="small" color="primary" label="Selected" />
                          ) : (
                            <Chip
                              size="small"
                              color={marketplace.connected ? 'success' : 'default'}
                              label={marketplace.connected ? 'Connected' : 'Unavailable'}
                            />
                          )}
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {marketplace.connected
                            ? 'Connected to this workspace and available for publishing.'
                            : marketplace.configured
                              ? 'Reconnect or verify this marketplace from Marketplace settings.'
                              : 'This channel is not configured for this workspace yet.'}
                        </Typography>
                      </Box>
                    }
                  />
                );
              })}
            </RadioGroup>
            {marketplaceError && (
              <FormHelperText id="target-marketplace-error">{marketplaceError}</FormHelperText>
            )}
          </FormControl>
        )}
        {activeStep === 5 && (
          <Stack spacing={2}>
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {values.name || 'Untitled product'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {values.sku || 'no-sku'} · {values.category || 'Uncategorised'} ·{' '}
                {values.tags.length} tag(s) · {values.images.length} image(s) ·{' '}
                {values.sellingPrice} price
              </Typography>
            </Box>
            <Alert severity="info">
              Creating saves a draft product. Marketplace publishing remains a separate confirmation
              step.
            </Alert>
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
