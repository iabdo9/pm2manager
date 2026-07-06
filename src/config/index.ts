/**
 * Centralised, validated application configuration.
 *
 * Environment variables are loaded from `.env` (via dotenv) and validated
 * with zod. Importing `config` from this module gives strongly-typed,
 * already-validated values. Any invalid configuration fails fast at startup.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/** Coerce common truthy string representations to a boolean. */
const booleanish = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  TRUST_PROXY: booleanish(false),

  SESSION_SECRET: z.string().min(1).default('insecure-dev-secret-change-me'),
  SESSION_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),

  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  TOTP_ISSUER: z.string().default('PM2 Manager'),

  DATABASE_PATH: z.string().default('./data/pm2manager.sqlite'),

  METRICS_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
  METRICS_RETENTION_DAYS: z.coerce.number().int().positive().default(7),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const isProduction = env.NODE_ENV === 'production';

/**
 * Whether the session cookie should carry the `Secure` flag.
 * "auto" enables it whenever we are trusting a proxy (i.e. behind TLS).
 */
const cookieSecure =
  env.COOKIE_SECURE === 'auto' ? env.TRUST_PROXY : env.COOKIE_SECURE === 'true';

export const config = {
  env: env.NODE_ENV,
  isProduction,
  server: {
    host: env.HOST,
    port: env.PORT,
    trustProxy: env.TRUST_PROXY,
  },
  session: {
    secret: env.SESSION_SECRET,
    /** Idle timeout in milliseconds. */
    timeoutMs: env.SESSION_TIMEOUT_MINUTES * 60 * 1000,
    cookieSecure,
  },
  rateLimit: {
    loginMax: env.LOGIN_RATE_LIMIT_MAX,
    loginWindowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  },
  totp: {
    issuer: env.TOTP_ISSUER,
  },
  database: {
    /** Absolute path to the SQLite file. */
    path: path.resolve(process.cwd(), env.DATABASE_PATH),
  },
  metrics: {
    intervalMs: env.METRICS_INTERVAL_SECONDS * 1000,
    retentionDays: env.METRICS_RETENTION_DAYS,
  },
  logging: {
    level: env.LOG_LEVEL,
  },
  admin: {
    username: env.ADMIN_USERNAME,
    password: env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length > 0 ? env.ADMIN_PASSWORD : null,
  },
} as const;

export type AppConfig = typeof config;

/** Warn loudly if an insecure default is used in production. */
export function assertProductionSafety(logWarn: (msg: string) => void): void {
  if (!isProduction) return;
  if (env.SESSION_SECRET === 'insecure-dev-secret-change-me') {
    logWarn(
      'SESSION_SECRET is using the insecure default. Set a strong SESSION_SECRET in production.',
    );
  }
  if (!cookieSecure) {
    logWarn(
      'Session cookie is not marked Secure. Serve the app over HTTPS and set TRUST_PROXY=true / COOKIE_SECURE=true.',
    );
  }
}
