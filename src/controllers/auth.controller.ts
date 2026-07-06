/**
 * Authentication controller.
 *
 * Implements the `/api/auth` HTTP contract: CSRF token issuance, password
 * login with optional TOTP second factor, logout, current-user lookup,
 * password change, and TOTP enrolment/enable/disable. Every mutation records
 * an audit-log entry. Sessions are regenerated on privilege changes (login and
 * successful 2FA) to defend against session fixation. Async handlers are
 * wrapped with {@link asyncHandler}; responses go through {@link sendSuccess};
 * failures throw typed errors from `../utils/errors`.
 */
import type { Request, RequestHandler, Response } from 'express';
import { getClientIp } from '../middleware/auth.middleware';
import { getCsrfToken } from '../middleware/csrf.middleware';
import { userRepository } from '../repositories/user.repository';
import { activityService } from '../services/activity.service';
import { authService } from '../services/auth.service';
import { totpService } from '../services/totp.service';
import type { SessionUser } from '../types';
import { asyncHandler } from '../utils/asyncHandler';
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from '../utils/errors';
import { sendSuccess } from '../utils/response';

/** Return the authenticated session user or throw if the session is invalid. */
function currentUser(req: Request): SessionUser {
  if (!req.session.user) {
    throw new UnauthorizedError();
  }
  return req.session.user;
}

/** Promisified `req.session.regenerate`. */
function regenerateSession(req: Request): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/** Promisified `req.session.save`. */
function saveSession(req: Request): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/** Promisified `req.session.destroy`. */
function destroySession(req: Request): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Regenerate the session id (session-fixation defence), attach the
 * authenticated user, and persist the session before responding.
 */
async function establishSession(req: Request, user: SessionUser): Promise<void> {
  await regenerateSession(req);
  req.session.user = user;
  await saveSession(req);
}

export const authController = {
  /** `GET /csrf-token` — issue the per-session CSRF token. Public. */
  csrfToken: ((req: Request, res: Response): void => {
    sendSuccess(res, { csrfToken: getCsrfToken(req) });
  }) as RequestHandler,

  /**
   * `POST /login` — verify credentials. Returns `{ twoFactorRequired: true }`
   * when the account has TOTP enabled (a pending challenge is stored), or
   * establishes the session and returns the user otherwise.
   */
  login: asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = req.body as { username: string; password: string };
    const user = await authService.verifyCredentials(username, password);

    if (!user) {
      activityService.record({
        type: 'login_failed',
        message: `Failed login for "${username}"`,
        username,
        ipAddress: getClientIp(req),
      });
      throw new UnauthorizedError('Invalid username or password');
    }

    if (user.totp_enabled === 1) {
      req.session.pending2fa = { userId: user.id, username: user.username };
      await saveSession(req);
      sendSuccess(res, { twoFactorRequired: true });
      return;
    }

    await establishSession(req, {
      id: user.id,
      username: user.username,
      isAdmin: user.is_admin === 1,
    });
    activityService.record({
      type: 'login_success',
      message: `User "${user.username}" logged in`,
      username: user.username,
      ipAddress: getClientIp(req),
    });
    sendSuccess(res, { twoFactorRequired: false, user: authService.toPublicUser(user) });
  }),

  /**
   * `POST /2fa` — complete a pending TOTP challenge. Requires a prior
   * successful password step (`session.pending2fa`).
   */
  verifyTwoFactor: asyncHandler(async (req: Request, res: Response) => {
    const pending = req.session.pending2fa;
    if (!pending) {
      throw new UnauthorizedError('No pending 2FA challenge');
    }
    const { token } = req.body as { token: string };
    const user = userRepository.findById(pending.userId);

    if (!user || !user.totp_secret || !totpService.verifyToken(token, user.totp_secret)) {
      activityService.record({
        type: 'login_failed',
        message: `Failed 2FA for "${pending.username}"`,
        username: pending.username,
        ipAddress: getClientIp(req),
      });
      throw new UnauthorizedError('Invalid authentication code');
    }

    delete req.session.pending2fa;
    await establishSession(req, {
      id: user.id,
      username: user.username,
      isAdmin: user.is_admin === 1,
    });
    activityService.record({
      type: 'login_success',
      message: `User "${user.username}" logged in`,
      username: user.username,
      ipAddress: getClientIp(req),
    });
    sendSuccess(res, { user: authService.toPublicUser(user) });
  }),

  /** `POST /logout` — destroy the session and clear the cookie. */
  logout: asyncHandler(async (req: Request, res: Response) => {
    const sessionUser = req.session.user;
    if (sessionUser) {
      activityService.record({
        type: 'logout',
        message: `User "${sessionUser.username}" logged out`,
        username: sessionUser.username,
        ipAddress: getClientIp(req),
      });
    }
    await destroySession(req);
    res.clearCookie('pm2m.sid');
    sendSuccess(res, {});
  }),

  /** `GET /me` — return the freshly-loaded authenticated user. */
  me: asyncHandler(async (req: Request, res: Response) => {
    const sessionUser = currentUser(req);
    const user = userRepository.findById(sessionUser.id);
    if (!user) {
      throw new UnauthorizedError();
    }
    sendSuccess(res, { user: authService.toPublicUser(user) });
  }),

  /** `POST /change-password` — change the authenticated user's password. */
  changePassword: asyncHandler(async (req: Request, res: Response) => {
    const sessionUser = currentUser(req);
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    await authService.changePassword(sessionUser.id, currentPassword, newPassword);
    activityService.record({
      type: 'password_changed',
      message: `User "${sessionUser.username}" changed their password`,
      username: sessionUser.username,
      ipAddress: getClientIp(req),
    });
    sendSuccess(res, {});
  }),

  /**
   * `POST /2fa/setup` — begin TOTP enrolment: generate a candidate secret,
   * stash it on the session, and return the secret, otpauth URI and QR image.
   */
  setupTwoFactor: asyncHandler(async (req: Request, res: Response) => {
    const sessionUser = currentUser(req);
    const user = userRepository.findById(sessionUser.id);
    if (!user) {
      throw new UnauthorizedError();
    }
    if (user.totp_enabled === 1) {
      throw new ConflictError('2FA already enabled');
    }
    const secret = totpService.generateSecret();
    req.session.pendingTotpSecret = secret;
    const otpauthUrl = totpService.buildOtpAuthUrl(user.username, secret);
    const qrDataUrl = await totpService.generateQrDataUrl(otpauthUrl);
    sendSuccess(res, { secret, otpauthUrl, qrDataUrl });
  }),

  /**
   * `POST /2fa/enable` — confirm enrolment by verifying a token against the
   * pending secret, then persist and activate the secret.
   */
  enableTwoFactor: asyncHandler(async (req: Request, res: Response) => {
    const sessionUser = currentUser(req);
    const secret = req.session.pendingTotpSecret;
    if (!secret) {
      throw new BadRequestError('Start 2FA setup first');
    }
    const { token } = req.body as { token: string };
    if (!totpService.verifyToken(token, secret)) {
      throw new UnauthorizedError('Invalid authentication code');
    }
    userRepository.setTotp(sessionUser.id, secret, true);
    delete req.session.pendingTotpSecret;
    activityService.record({
      type: 'twofa_enabled',
      message: `User "${sessionUser.username}" enabled two-factor authentication`,
      username: sessionUser.username,
      ipAddress: getClientIp(req),
    });
    sendSuccess(res, {});
  }),

  /** `POST /2fa/disable` — disable TOTP after re-verifying the password. */
  disableTwoFactor: asyncHandler(async (req: Request, res: Response) => {
    const sessionUser = currentUser(req);
    const { password } = req.body as { password: string };
    const user = userRepository.findById(sessionUser.id);
    if (!user) {
      throw new UnauthorizedError();
    }
    const ok = await authService.verifyPassword(user.password_hash, password);
    if (!ok) {
      throw new UnauthorizedError('Password is incorrect');
    }
    userRepository.setTotp(user.id, null, false);
    activityService.record({
      type: 'twofa_disabled',
      message: `User "${user.username}" disabled two-factor authentication`,
      username: user.username,
      ipAddress: getClientIp(req),
    });
    sendSuccess(res, {});
  }),
};
