// Shared helpers for translating trusted persisted rows into domain entities.
// These are pure (no DB, no config) so they are safe to unit-test in isolation.

import type { Result } from '../../../domain/shared/Result';

// Persisted data is trusted: entity factories that return Result should always
// succeed. If reconstitution fails it means the row is corrupt / schema drift,
// which is a programmer/data error, so we surface it loudly.
export function unwrapPersisted<T>(result: Result<T>): T {
  if (result.isErr()) {
    throw new Error(
      `Persistence mapping failed to reconstitute a trusted entity: ${result.error.message}`,
    );
  }
  return result.value;
}

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function toNullableDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

// DECIMAL columns come back from node-pg as strings; INT columns as numbers.
export function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}
