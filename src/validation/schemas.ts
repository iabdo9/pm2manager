/**
 * Zod validation schemas for all request inputs. Kept in one place so the API
 * contract (and its coercions/limits) is easy to audit and reuse.
 */
import { z } from 'zod';

// --- Auth -----------------------------------------------------------------

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(64),
  password: z.string().min(1, 'Password is required').max(256),
});

/** A 6-digit TOTP code (used for the 2FA login step and for enabling 2FA). */
const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

export const twoFactorLoginSchema = z.object({
  token: totpCode,
});

export const enableTwoFactorSchema = z.object({
  token: totpCode,
});

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, 'Password is required').max(256),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(256),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(256),
});

// --- User management ------------------------------------------------------

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'Only letters, numbers, dot, underscore and dash are allowed'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
  isAdmin: z.boolean().optional().default(false),
});

export const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// --- Processes ------------------------------------------------------------

/**
 * A single PM2 process identifier — a numeric pm_id or a process name.
 * The reserved keyword "all" is rejected so single-process routes can never be
 * used to act on (or delete) every process at once; bulk operations have their
 * own dedicated, explicit endpoints.
 */
const processTarget = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => v.toLowerCase() !== 'all', {
    message: 'The reserved target "all" is not allowed here',
  });

export const processIdParamSchema = z.object({
  idOrName: processTarget,
});

export const processActionParamSchema = z.object({
  idOrName: processTarget,
  action: z.enum(['start', 'stop', 'restart', 'reload']),
});

export const bulkActionParamSchema = z.object({
  action: z.enum(['start-all', 'stop-all', 'restart-all', 'reload-all']),
});

export const logStreamParamSchema = processIdParamSchema;

// --- History / metrics ----------------------------------------------------

export const historyQuerySchema = z.object({
  /** Optional process name; when omitted, aggregate/overall series is returned. */
  name: z.string().trim().min(1).max(200).optional(),
  /** Shorthand time range. */
  range: z.enum(['1h', '6h', '24h', '7d']).optional().default('6h'),
  /** Explicit bounds (epoch ms) override `range` when provided. */
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
});

// --- Activity -------------------------------------------------------------

export const activityTypeEnum = z.enum([
  'login_success',
  'login_failed',
  'logout',
  'twofa_enabled',
  'twofa_disabled',
  'password_changed',
  'user_created',
  'user_deleted',
  'settings_changed',
  'process_start',
  'process_stop',
  'process_restart',
  'process_reload',
  'process_delete',
  'process_start_all',
  'process_stop_all',
  'process_restart_all',
  'process_reload_all',
  'process_event',
]);

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  type: activityTypeEnum.optional(),
});

// --- Settings -------------------------------------------------------------

export const updateSettingsSchema = z.object({
  metricsIntervalSeconds: z.coerce.number().int().min(5).max(3600).optional(),
  metricsRetentionDays: z.coerce.number().int().min(1).max(365).optional(),
});

// Inferred input types (handy for controllers).
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
