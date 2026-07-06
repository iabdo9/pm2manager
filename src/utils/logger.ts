/**
 * Application logger built on pino.
 *
 * In development, logs are pretty-printed for readability. In production,
 * structured JSON is emitted so it can be ingested by log tooling (and by
 * PM2's own log files when running under PM2).
 */
import pino, { type Logger } from 'pino';
import { config } from '../config';

const transport = config.isProduction
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };

export const logger: Logger = pino({
  level: config.logging.level,
  ...(transport ? { transport } : {}),
});

/** Create a child logger tagged with a module name. */
export function createLogger(module: string): Logger {
  return logger.child({ module });
}
