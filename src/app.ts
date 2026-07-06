/**
 * Express application factory.
 *
 * Wires together security headers, compression, request logging, sessions
 * (persisted in SQLite), static assets, the authenticated HTML pages, the
 * REST API (rate-limited and CSRF-protected) and the central error handling.
 * Building the app is separated from starting the server (see `index.ts`) to
 * keep bootstrap concerns testable and explicit.
 */
import path from 'node:path';
import express, { type Express } from 'express';
import session from 'express-session';
import compression from 'compression';
import pinoHttp from 'pino-http';
import createSqliteStore from 'better-sqlite3-session-store';

import { config } from './config';
import { getDb } from './db';
import { logger } from './utils/logger';

import { securityHeaders } from './middleware/security.middleware';
import { csrfProtection } from './middleware/csrf.middleware';
import { apiRateLimiter } from './middleware/rateLimit.middleware';
import { notFoundHandler, errorHandler } from './middleware/error.middleware';
import { requirePage, redirectIfAuthenticated } from './middleware/auth.middleware';

import { authRouter } from './routes/auth.routes';
import { processRouter } from './routes/process.routes';
import { dashboardRouter } from './routes/dashboard.routes';
import { historyRouter } from './routes/history.routes';
import { activityRouter } from './routes/activity.routes';
import { settingsRouter } from './routes/settings.routes';
import { userRouter } from './routes/user.routes';

/** Directory containing the static frontend (project-root `public/`). */
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createApp(): Express {
  const app = express();

  // Behind a TLS-terminating reverse proxy we must trust X-Forwarded-* headers
  // so that secure cookies and client IPs work correctly.
  if (config.server.trustProxy) {
    app.set('trust proxy', 1);
  }
  app.disable('x-powered-by');

  // Security headers (helmet + strict CSP).
  app.use(securityHeaders());

  // Compression — but never for Server-Sent Events (it would buffer the stream).
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers.accept?.includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Structured request logging (skip noisy static asset requests).
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/static') },
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  // Sessions, persisted in the same SQLite database.
  const SqliteStore = createSqliteStore(session);
  const store = new SqliteStore({
    client: getDb(),
    expired: { clear: true, intervalMs: 15 * 60 * 1000 },
  });

  app.use(
    session({
      name: 'pm2m.sid',
      secret: config.session.secret,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true, // reset idle timeout on each request (automatic expiration)
      cookie: {
        httpOnly: true,
        secure: config.session.cookieSecure,
        sameSite: 'lax',
        maxAge: config.session.timeoutMs,
        path: '/',
      },
    }),
  );

  // --- HTML pages (auth-gated) --------------------------------------------
  app.get('/login', redirectIfAuthenticated, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  });
  app.get('/', requirePage, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
  });
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, data: { status: 'up' } });
  });

  // --- Static assets (no secrets; safe to serve openly) -------------------
  app.use(
    '/static',
    express.static(path.join(PUBLIC_DIR, 'static'), {
      index: false,
      maxAge: config.isProduction ? '1h' : 0,
    }),
  );

  // --- REST API (rate-limited + CSRF-protected) ---------------------------
  app.use('/api', apiRateLimiter, csrfProtection);
  app.use('/api/auth', authRouter);
  app.use('/api/processes', processRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/users', userRouter);

  // --- Fallbacks ----------------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
