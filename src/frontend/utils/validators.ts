// Lightweight client-side validation helpers. Server-side validation (Joi)
// remains the source of truth; these only improve UX. Rules reuse shared
// domain invariants where they exist.
import {
  PRODUCT_DESCRIPTION_MIN_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
} from '@shared/constants';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isRequired(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isNonNegativeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function minLength(value: string, min: number): boolean {
  return value.trim().length >= min;
}

export function maxLength(value: string, max: number): boolean {
  return value.trim().length <= max;
}

// Returns an error message, or null when valid.
export function validateProductDescription(value: string): string | null {
  const len = value.trim().length;
  if (len < PRODUCT_DESCRIPTION_MIN_LENGTH) {
    return `Description must be at least ${PRODUCT_DESCRIPTION_MIN_LENGTH} characters.`;
  }
  if (len > PRODUCT_DESCRIPTION_MAX_LENGTH) {
    return `Description must be at most ${PRODUCT_DESCRIPTION_MAX_LENGTH} characters.`;
  }
  return null;
}

export function validateEmail(value: string): string | null {
  if (!isRequired(value)) return 'Email is required.';
  if (!isValidEmail(value)) return 'Enter a valid email address.';
  return null;
}

export function validatePrice(value: unknown): string | null {
  if (!isNonNegativeNumber(value)) return 'Price must be a non-negative number.';
  return null;
}
