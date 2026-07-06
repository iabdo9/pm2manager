/**
 * Central error handling.
 *
 * `notFoundHandler` produces a consistent 404 for unmatched API routes.
 * `errorHandler` converts thrown errors — AppError, ZodError or anything
 * unexpected — into the standard JSON error envelope, logging server-side
 * faults without leaking internal detail to the client.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isAppError, NotFoundError } from '../utils/errors';
import { sendError } from '../utils/response';
import { createLogger } from '../utils/logger';

const log = createLogger('http');

/** 404 handler for unmatched routes (mounted after all routes). */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
}

/** Final error-handling middleware. Must keep the 4-argument signature. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    // Delegate to Express's default handler once a response has started.
    return;
  }

  if (isAppError(err)) {
    if (!err.isOperational || err.statusCode >= 500) {
      log.error({ err, path: req.path }, err.message);
    }
    sendError(res, err.message, err.code, err.statusCode, err.details);
    return;
  }

  if (err instanceof ZodError) {
    sendError(res, 'Validation failed', 'VALIDATION_ERROR', 422, err.flatten());
    return;
  }

  // Errors from body-parser / http-errors (malformed JSON, payload too large)
  // carry a client 4xx status. Honour it instead of masking it as a 500.
  const httpErr = err as { status?: number; statusCode?: number; expose?: boolean; message?: string };
  const status = httpErr.status ?? httpErr.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const message = httpErr.expose && httpErr.message ? httpErr.message : 'Bad request';
    sendError(res, message, 'BAD_REQUEST', status);
    return;
  }

  // Unknown / programmer error: log everything, tell the client nothing.
  log.error({ err, path: req.path }, 'Unhandled error');
  sendError(res, 'An unexpected error occurred', 'INTERNAL_ERROR', 500);
}
