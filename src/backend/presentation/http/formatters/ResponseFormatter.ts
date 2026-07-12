// Response formatting helpers producing the exact ARCHITECTURE.md §18 envelope.
// Every controller translates its Result/data through these so the wire contract the
// frontend (RTK Query) depends on stays consistent.
//
//   Success:   { success: true, data }
//   Paginated: { success: true, data: [...], pagination: { page, limit, total, totalPages } }
//   Error:     { success: false, error: { code, message, details? } }

import type { Response } from 'express';
import { DomainError } from '../../../domain/shared/DomainError';
import { ERROR_CODES } from '../../../../shared/constants';
import { isProduction } from '../../../config/env';

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: ErrorDetail[] | Record<string, unknown>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Map a DomainError (or arbitrary error) to an HTTP status code (§5 / §19).
export function statusForError(error: unknown): number {
  if (error instanceof DomainError) {
    switch (error.code) {
      case 'VALIDATION_ERROR':
        return 400;
      case 'NOT_FOUND':
        return 404;
      case 'CONFLICT':
        return 409;
      case 'INVALID_STATE':
      case 'GUARDRAIL_VIOLATION':
        return 422;
      default:
        return 500;
    }
  }
  return 500;
}

export function toErrorBody(error: unknown): ErrorBody {
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message };
  }
  // Never leak internal error details/stack traces in production.
  const message =
    !isProduction && error instanceof Error ? error.message : 'Internal server error';
  return { code: ERROR_CODES.INTERNAL_ERROR, message };
}

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data });
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, 201);
}

export function paginated<T>(
  res: Response,
  items: T[],
  pagination: PaginationMeta,
): Response {
  return res.status(200).json({ success: true, data: items, pagination });
}

// Send an error envelope directly. Prefer forwarding domain errors to
// ErrorHandlingMiddleware via next(); this is used where a direct send is required
// (auth challenges, validation middleware).
export function fail(
  res: Response,
  error: unknown,
  status?: number,
  body?: ErrorBody,
): Response {
  return res
    .status(status ?? statusForError(error))
    .json({ success: false, error: body ?? toErrorBody(error) });
}
