// Presentation formatters. Currency/timezone default to the shared domain
// defaults but callers should pass the active workspace's currency/timezone.
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE } from '@shared/constants';

export function formatCurrency(
  amount: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  locale = 'en-US',
): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatNumber(value: number | null | undefined, locale = 'en-US'): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 1,
  locale = 'en-US',
): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}

export function formatDate(
  iso: string | Date | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
  locale = 'en-US',
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone,
  }).format(date);
}

export function formatDateTime(
  iso: string | Date | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
  locale = 'en-US',
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

// Relative time such as "3 hours ago" — handy for Hermes activity feeds.
export function formatRelativeTime(iso: string | Date | null | undefined, locale = 'en-US'): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = date.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
    { amount: 60, unit: 'second' },
    { amount: 60, unit: 'minute' },
    { amount: 24, unit: 'hour' },
    { amount: 7, unit: 'day' },
    { amount: 4.34524, unit: 'week' },
    { amount: 12, unit: 'month' },
    { amount: Number.POSITIVE_INFINITY, unit: 'year' },
  ];
  let duration = diffMs / 1000;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return rtf.format(Math.round(duration), 'year');
}
