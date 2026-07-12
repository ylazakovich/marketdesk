// Railway-oriented Result type used by all domain services and entity factories.
// Usage:
//   const r = Product.create(...);
//   if (r.isErr()) return r;          // short-circuit, error propagates
//   const product = r.value;          // safe access
//
// `Ok` / `Err` exist both as types and as constructor functions (declaration
// merging), so `Result<T>` reads naturally while `Ok(x)` / `Err(e)` build values.

import { DomainError } from './DomainError';

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
  isOk(): this is Ok<T>;
  isErr(): false;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
  isOk(): false;
  isErr(): this is Err<E>;
}

export type Result<T, E = DomainError> = Ok<T> | Err<E>;

export function Ok<T>(value: T): Ok<T> {
  return {
    ok: true,
    value,
    isOk(): this is Ok<T> {
      return true;
    },
    isErr(): false {
      return false;
    },
  };
}

export function Err<E = DomainError>(error: E): Err<E> {
  return {
    ok: false,
    error,
    isOk(): false {
      return false;
    },
    isErr(): this is Err<E> {
      return true;
    },
  };
}

// Collect an array of Results into a Result of an array (fails on first Err).
export function combine<T, E>(results: Array<Result<T, E>>): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (r.isErr()) {
      return r;
    }
    values.push(r.value);
  }
  return Ok(values);
}
