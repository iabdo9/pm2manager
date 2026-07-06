/**
 * Rate limiting (express-rate-limit).
 *
 * A strict limiter guards the authentication endpoints (login / 2FA) to slow
 * down brute-force attempts; a looser limiter protects the rest of the API
 * from accidental floods. Both emit responses in the standard error envelope.
 */
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { config } from '../config';
import { sendError } from '../utils/response';

function limitReached(_req: Request, res: Response): void {
  sendError(res, 'Too many requests, please try again later.', 'TOO_MANY_REQUESTS', 429);
}

/** Strict limiter for authentication endpoints. */
export const loginRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  // Count only failed attempts against the limit; a successful login resets.
  skipSuccessfulRequests: true,
  handler: limitReached,
});

/** General API limiter to prevent floods. */
export const apiRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitReached,
});
