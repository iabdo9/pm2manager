/**
 * HTTP security headers via helmet, plus a strict Content-Security-Policy.
 *
 * The frontend deliberately uses only external (`'self'`) scripts and styles
 * — no inline JS/CSS — so the CSP can forbid inline execution. `data:` images
 * are permitted because TOTP enrolment QR codes are delivered as data URIs.
 */
import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { config } from '../config';

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        // Only force HTTPS upgrades when we are actually serving over TLS.
        ...(config.session.cookieSecure ? {} : { upgradeInsecureRequests: null }),
      },
    },
    // HSTS only makes sense over HTTPS; enable when cookies are Secure.
    hsts: config.session.cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  });
}
