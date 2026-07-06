/**
 * Request validation middleware backed by zod.
 *
 * Each factory validates one part of the request. On success the parsed
 * (and coerced) value replaces the original `req.body`/`req.query`/`req.params`
 * so downstream handlers work with typed, sanitised data. On failure a
 * `ValidationError` (HTTP 422) with field-level details is forwarded.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors';

type Source = 'body' | 'query' | 'params';

function makeValidator(source: Source) {
  return (schema: ZodSchema): RequestHandler =>
    (req: Request, _res: Response, next: NextFunction): void => {
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        next(new ValidationError('Validation failed', result.error.flatten()));
        return;
      }
      // Replace with the parsed value (query/params are read-only getters in
      // Express 5, so assign defensively).
      try {
        req[source] = result.data as never;
      } catch {
        Object.defineProperty(req, source, { value: result.data, configurable: true });
      }
      next();
    };
}

export const validateBody = makeValidator('body');
export const validateQuery = makeValidator('query');
export const validateParams = makeValidator('params');
