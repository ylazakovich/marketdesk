// Central Express error handler. Controllers forward domain failures here via
// next(result.error); thrown/unexpected errors also land here. Maps DomainError
// subclasses to HTTP status codes and emits the §18 error envelope. Stack traces are
// never leaked in production (see toErrorBody).

import type { ErrorRequestHandler } from 'express';
import { statusForError, toErrorBody } from '../formatters/ResponseFormatter';
import { DomainError } from '../../../domain/shared/DomainError';

export interface ErrorLogger {
  error(obj: unknown, msg?: string): void;
}

export function createErrorHandler(logger?: ErrorLogger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (res.headersSent) {
      return;
    }
    const status = statusForError(err);
    // Only log unexpected (non-domain) errors and 5xx as errors; domain errors are
    // expected control flow.
    if (logger && (!(err instanceof DomainError) || status >= 500)) {
      logger.error({ err }, 'Request error');
    }
    res.status(status).json({ success: false, error: toErrorBody(err) });
  };
}
