/**
 * Helpers for producing the consistent API envelope defined in
 * `types/index.ts`. Controllers should use these instead of calling
 * `res.json` directly so success/error shapes stay uniform.
 */
import type { Response } from 'express';
import type { ApiError, ApiSuccess } from '../types';

/** Send a successful JSON response wrapped in the standard envelope. */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  const body: ApiSuccess<T> = { ok: true, data };
  res.status(statusCode).json(body);
}

/** Send an error JSON response wrapped in the standard envelope. */
export function sendError(
  res: Response,
  message: string,
  code: string,
  statusCode: number,
  details?: unknown,
): void {
  const body: ApiError = {
    ok: false,
    error: { message, code, ...(details !== undefined ? { details } : {}) },
  };
  res.status(statusCode).json(body);
}
