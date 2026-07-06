/**
 * Augment express-session's `SessionData` with the fields this app stores.
 */
import 'express-session';
import type { SessionUser } from './index';

declare module 'express-session' {
  interface SessionData {
    /** Present once the user is fully authenticated (post-2FA). */
    user?: SessionUser;
    /** Set after a correct password when the account still needs a TOTP code. */
    pending2fa?: {
      userId: number;
      username: string;
    };
    /** Candidate TOTP secret held during 2FA enrolment, before confirmation. */
    pendingTotpSecret?: string;
    /** Per-session CSRF synchroniser secret. */
    csrfSecret?: string;
  }
}
