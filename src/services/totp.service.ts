/**
 * TOTP (time-based one-time password) service.
 *
 * Thin wrapper around `otplib` (secret generation, otpauth URI construction,
 * token verification) and `qrcode` (rendering the enrolment URI as a scannable
 * data-URL image). Keeps the two-factor primitives in one place so controllers
 * stay free of library-specific details.
 */
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { config } from '../config';

export const totpService = {
  /** Generate a new Base32 TOTP secret for enrolling a user. */
  generateSecret(): string {
    return authenticator.generateSecret();
  },

  /**
   * Build the `otpauth://` URI encoding the account, issuer and secret that
   * authenticator apps consume when enrolling a new key.
   */
  buildOtpAuthUrl(username: string, secret: string): string {
    return authenticator.keyuri(username, config.totp.issuer, secret);
  },

  /** Verify a 6-digit token against a user's TOTP secret. */
  verifyToken(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  },

  /** Render an otpauth URI as a PNG data-URL suitable for an `<img>` src. */
  async generateQrDataUrl(otpauthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpauthUrl);
  },
};
