/**
 * CSRF protection using the synchroniser-token pattern.
 *
 * A random secret is stored in the server-side session and must be echoed
 * back by the client in the `X-CSRF-Token` header on every state-changing
 * request. Because the token lives in the session (not readable cross-origin)
 * and is compared with a constant-time check, this defends against CSRF
 * without relying on the SameSite cookie attribute alone.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HEADER = 'x-csrf-token';

/** Ensure the session carries a CSRF secret and return it. */
export function getCsrfToken(req: Request): string {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfSecret;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Reject state-changing requests that do not present a valid CSRF token.
 * Safe (read-only) methods pass through untouched.
 */
export const csrfProtection: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const secret = req.session.csrfSecret;
  const provided = req.get(HEADER);

  if (!secret || !provided || !constantTimeEquals(provided, secret)) {
    next(new ForbiddenError('Invalid or missing CSRF token'));
    return;
  }
  next();
};
