// Reusable field controls shared by ProductForm and the wizard.
import React from 'react';
import {
  Autocomplete,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import type { ProductCondition, ProductStatus } from '@shared/types';
import { PRODUCT_STATUS_LIST, PRODUCT_DESCRIPTION_MAX_LENGTH } from '@shared/constants';
import { CONDITION_LABELS, CONDITION_LIST } from '../../utils/labels.js';
import { ProductStatusBadge } from '../common/Badge.js';
import type { ProductFormValues, ProductFieldErrors } from './productFormModel.js';

export interface ProductFieldsProps {
  values: ProductFormValues;
  errors: ProductFieldErrors;
  onChange: <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => void;
  showStatus?: boolean;
}

function parseNumber(raw: string): number {
  if (raw.trim() === '') return NaN;
  return Number(raw);
}

export const NameSkuFields: React.FC<ProductFieldsProps> = ({ values, errors, onChange }) => (
  <Stack spacing={2}>
    <TextField
      label="Name"
      required
      fullWidth
      value={values.name}
      onChange={(e) => onChange('name', e.target.value)}
      error={Boolean(errors.name)}
      helperText={errors.name}
    />
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField
        label="SKU"
        required
        fullWidth
        value={values.sku}
        onChange={(e) => onChange('sku', e.target.value)}
        error={Boolean(errors.sku)}
        helperText={errors.sku}
      />
      <TextField
        label="Category"
        fullWidth
        value={values.category}
        onChange={(e) => onChange('category', e.target.value)}
      />
    </Stack>
    <FormControl fullWidth>
      <InputLabel id="condition-label">Condition</InputLabel>
      <Select
        labelId="condition-label"
        label="Condition"
        value={values.condition}
        onChange={(e) => onChange('condition', e.target.value as ProductCondition)}
      >
        {CONDITION_LIST.map((c) => (
          <MenuItem key={c} value={c}>
            {CONDITION_LABELS[c]}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  </Stack>
);

export const DescriptionTagsFields: React.FC<ProductFieldsProps> = ({
  values,
  errors,
  onChange,
}) => (
  <Stack spacing={2}>
    <TextField
      label="Description"
      required
      fullWidth
      multiline
      minRows={4}
      value={values.description}
      onChange={(e) => onChange('description', e.target.value)}
      error={Boolean(errors.description)}
      helperText={
        errors.description ?? `${values.description.trim().length}/${PRODUCT_DESCRIPTION_MAX_LENGTH}`
      }
    />
    <Autocomplete
      multiple
      freeSolo
      options={[]}
      value={values.tags}
      onChange={(_e, next) => onChange('tags', next as string[])}
      renderTags={(value, getTagProps) =>
        value.map((option, index) => (
          <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} />
        ))
      }
      renderInput={(params) => (
        <TextField {...params} label="Tags" placeholder="Add a tag and press Enter" />
      )}
    />
  </Stack>
);

export const PriceFields: React.FC<ProductFieldsProps> = ({ values, errors, onChange }) => (
  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
    <TextField
      label="Cost price"
      type="number"
      fullWidth
      value={Number.isNaN(values.costPrice) ? '' : values.costPrice}
      onChange={(e) => onChange('costPrice', parseNumber(e.target.value))}
      error={Boolean(errors.costPrice)}
      helperText={errors.costPrice}
      inputProps={{ min: 0, step: '0.01' }}
    />
    <TextField
      label="Selling price"
      type="number"
      fullWidth
      value={Number.isNaN(values.sellingPrice) ? '' : values.sellingPrice}
      onChange={(e) => onChange('sellingPrice', parseNumber(e.target.value))}
      error={Boolean(errors.sellingPrice)}
      helperText={errors.sellingPrice}
      inputProps={{ min: 0, step: '0.01' }}
    />
  </Stack>
);

export const ImagesField: React.FC<ProductFieldsProps> = ({ values, onChange }) => (
  <Autocomplete
    multiple
    freeSolo
    options={[]}
    value={values.images}
    onChange={(_e, next) => onChange('images', next as string[])}
    renderTags={(value, getTagProps) =>
      value.map((option, index) => (
        <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} />
      ))
    }
    renderInput={(params) => (
      <TextField {...params} label="Image URLs" placeholder="Paste an image URL and press Enter" />
    )}
  />
);

export const StatusField: React.FC<ProductFieldsProps> = ({ values, onChange }) => (
  <FormControl fullWidth>
    <InputLabel id="status-label">Status</InputLabel>
    <Select
      labelId="status-label"
      label="Status"
      value={values.status}
      onChange={(e) => onChange('status', e.target.value as ProductStatus)}
      renderValue={(value) => <ProductStatusBadge status={value as ProductStatus} />}
    >
      {PRODUCT_STATUS_LIST.map((s) => (
        <MenuItem key={s} value={s}>
          <ProductStatusBadge status={s} />
        </MenuItem>
      ))}
    </Select>
  </FormControl>
);
