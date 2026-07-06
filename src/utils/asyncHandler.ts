/**
 * Wraps an async Express handler so that any rejected promise is forwarded
 * to `next()` and handled by the central error middleware. This removes the
 * need for try/catch boilerplate in every controller.
 */
import type { NextFunction, Request, Response } from 'express';

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
