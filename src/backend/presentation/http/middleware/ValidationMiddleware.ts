// Body validation middleware. Parses req.body against a zod schema; on failure sends
// the §18 error envelope with per-field details (400, VALIDATION_ERROR). On success it
// replaces req.body with the parsed (and coerced) value so controllers get a clean DTO.

import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ERROR_CODES } from '../../../../shared/constants';
import { fail, type ErrorDetail } from '../formatters/ResponseFormatter';

function toDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      fail(res, undefined, 400, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Request validation failed',
        details: toDetails(result.error),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
