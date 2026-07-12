// Wraps an async Express handler so rejected promises are forwarded to next() and
// therefore reach ErrorHandlingMiddleware instead of crashing the process.

import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
