/**
 * Application entrypoint.
 *
 * Bootstraps the database, ensures an initial administrator exists, connects
 * to the PM2 daemon (attaching the event bus for log streaming and process
 * events), starts the metrics collector and finally launches the HTTP server.
 * Handles graceful shutdown on SIGINT/SIGTERM.
 */
import type { Server } from 'node:http';
import { createApp } from './app';
import { config, assertProductionSafety } from './config';
import { initDatabase, closeDatabase } from './db';
import { logger } from './utils/logger';
import { pm2Service, type Pm2ProcessEvent } from './services/pm2.service';
import { metricsService } from './services/metrics.service';
import { activityService } from './services/activity.service';
import { authService } from './services/auth.service';

/** PM2 lifecycle events we consider worth recording in the activity log. */
const RECORDED_PM2_EVENTS = new Set([
  'restart',
  'restart overlimit',
  'exit',
  'stop',
  'online',
  'delete',
]);

/** Tracks whether the HTTP server is accepting connections. */
let serverReady = false;

/**
 * Install process-level guards early — before we touch PM2. The PM2 client's
 * socket layer can emit asynchronous `error` events on connection failure that
 * would otherwise crash the process (an unhandled 'error' event). We prefer to
 * log and keep serving the UI (with PM2 shown as offline) once the server is up.
 */
function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    // Before the server is listening a fatal error means we cannot serve at
    // all — exit so a supervisor can restart us. Once serving, stay up.
    if (!serverReady) {
      process.exit(1);
    }
  });
}

async function bootstrap(): Promise<void> {
  installProcessGuards();

  // 1. Database + config safety.
  initDatabase();
  assertProductionSafety((msg) => logger.warn(msg));

  // 2. Ensure an initial admin account exists.
  const admin = await authService.ensureInitialAdmin();
  if (admin.created) {
    logger.info(`Created initial administrator "${admin.username}".`);
    if (admin.generatedPassword) {
      logger.warn(
        `A random password was generated for "${admin.username}": ${admin.generatedPassword}\n` +
          'Log in and change it immediately. This password is shown only once.',
      );
    }
  }

  // 3. Connect to PM2 and attach the event bus (best-effort; retried lazily).
  try {
    await pm2Service.connect();
    await pm2Service.initBus();
  } catch (err) {
    logger.error({ err }, 'Could not connect to PM2 at startup; will retry on demand.');
  }

  // Record notable PM2 lifecycle events (e.g. automatic restarts / crashes).
  pm2Service.events.on('process', (evt: Pm2ProcessEvent) => {
    if (!RECORDED_PM2_EVENTS.has(evt.event)) return;
    activityService.record({
      type: 'process_event',
      message: `Process "${evt.name}" event: ${evt.event}`,
      username: null,
      metadata: { pmId: evt.pmId, event: evt.event },
    });
  });

  // 4. Start periodic metrics collection + retention.
  metricsService.start();

  // 5. Start the HTTP server.
  const app = createApp();
  const server: Server = app.listen(config.server.port, config.server.host, () => {
    serverReady = true;
    logger.info(
      `PM2 Manager listening on http://${config.server.host}:${config.server.port} (${config.env})`,
    );
  });

  setupGracefulShutdown(server);
}

function setupGracefulShutdown(server: Server): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down gracefully.`);

    metricsService.stop();
    pm2Service.disconnect();

    server.close(() => {
      closeDatabase();
      logger.info('Shutdown complete.');
      process.exit(0);
    });

    // Long-lived SSE log streams would otherwise keep the server open forever;
    // destroy all sockets so `server.close` can complete promptly.
    server.closeAllConnections?.();

    // Force-exit if connections do not drain in time — still close the DB.
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout.');
      closeDatabase();
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});
