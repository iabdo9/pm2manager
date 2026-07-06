/**
 * Authentication routes (`/api/auth`).
 *
 * Wires the auth controller to the `/api/auth` contract. This router does NOT
 * globally require authentication: login, 2FA, logout and CSRF-token issuance
 * are reachable without a session, while account operations are individually
 * guarded with `requireAuth`. The strict `loginRateLimiter` protects the
 * credential-checking endpoints. CSRF protection and the general API rate
 * limiter are applied globally in `app.ts` and are intentionally not repeated
 * here.
 */
import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { loginRateLimiter } from '../middleware/rateLimit.middleware';
import { validateBody } from '../middleware/validate.middleware';
import {
  changePasswordSchema,
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  loginSchema,
  twoFactorLoginSchema,
} from '../validation/schemas';

/** Express router mounted at `/api/auth`. */
export const authRouter = Router();

// --- Public / unauthenticated -------------------------------------------
authRouter.get('/csrf-token', authController.csrfToken);
authRouter.post('/login', loginRateLimiter, validateBody(loginSchema), authController.login);
authRouter.post(
  '/2fa',
  loginRateLimiter,
  validateBody(twoFactorLoginSchema),
  authController.verifyTwoFactor,
);
authRouter.post('/logout', authController.logout);

// --- Authenticated account operations -----------------------------------
authRouter.get('/me', requireAuth, authController.me);
authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  authController.changePassword,
);
authRouter.post('/2fa/setup', requireAuth, authController.setupTwoFactor);
authRouter.post(
  '/2fa/enable',
  requireAuth,
  validateBody(enableTwoFactorSchema),
  authController.enableTwoFactor,
);
authRouter.post(
  '/2fa/disable',
  requireAuth,
  validateBody(disableTwoFactorSchema),
  authController.disableTwoFactor,
);

export default authRouter;
