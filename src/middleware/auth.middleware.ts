/**
 * Authentication & authorisation middleware.
 *
 * `requireAuth` / `requireAdmin` guard API routes (JSON 401/403).
 * `requirePage` / `redirectIfAuthenticated` guard HTML page routes (redirects).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

/** Best-effort extraction of the client IP (honours a trusted proxy). */
export function getClientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Require a fully-authenticated session for API access. */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (req.session?.user) {
    next();
    return;
  }
  next(new UnauthorizedError());
};

/** Require an authenticated administrator for API access. */
export const requireAdmin: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.session?.user) {
    next(new UnauthorizedError());
    return;
  }
  if (!req.session.user.isAdmin) {
    next(new ForbiddenError('Administrator privileges required'));
    return;
  }
  next();
};

/** Guard an HTML page: redirect unauthenticated users to the login page. */
export const requirePage: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (req.session?.user) {
    next();
    return;
  }
  res.redirect('/login');
};

/** For the login page: send already-authenticated users to the dashboard. */
export const redirectIfAuthenticated: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.session?.user) {
    res.redirect('/');
    return;
  }
  next();
};
