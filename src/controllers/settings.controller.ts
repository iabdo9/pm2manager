/**
 * Settings controller.
 *
 * Exposes the small set of runtime-tunable application settings (metrics
 * sampling interval and retention window). Values are persisted in the
 * key/value `settings` table and fall back to the configuration-derived
 * defaults when unset.
 */
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { getClientIp } from '../middleware/auth.middleware';
import { settingsRepository } from '../repositories/settings.repository';
import { activityService } from '../services/activity.service';
import { metricsService } from '../services/metrics.service';
import { config } from '../config';
import type { UpdateSettingsInput } from '../validation/schemas';

/** Persisted settings keys. */
const KEY_INTERVAL = 'metricsIntervalSeconds';
const KEY_RETENTION = 'metricsRetentionDays';

/** The public shape of the settings payload. */
interface SettingsView {
  metricsIntervalSeconds: number;
  metricsRetentionDays: number;
}

/** Parse a stored string to a finite number, falling back to a default. */
function toNumberOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read the current effective settings, applying config-derived defaults. */
function readSettings(): SettingsView {
  return {
    metricsIntervalSeconds: toNumberOr(
      settingsRepository.get(KEY_INTERVAL),
      config.metrics.intervalMs / 1000,
    ),
    metricsRetentionDays: toNumberOr(
      settingsRepository.get(KEY_RETENTION),
      config.metrics.retentionDays,
    ),
  };
}

export const settingsController = {
  /**
   * GET /api/settings — return the current effective settings as numbers,
   * falling back to configuration defaults when a value has not been set.
   */
  getSettings: asyncHandler(async (_req, res) => {
    sendSuccess(res, readSettings());
  }),

  /**
   * PUT /api/settings — persist the provided settings fields.
   *
   * Only fields present in the (already-validated) body are written. The
   * change is audited, the metrics collector is rescheduled so a new sampling
   * interval takes effect immediately, and the merged settings are returned.
   */
  updateSettings: asyncHandler(async (req, res) => {
    const input = req.body as UpdateSettingsInput;
    const changes: Record<string, number> = {};

    if (input.metricsIntervalSeconds !== undefined) {
      settingsRepository.set(KEY_INTERVAL, String(input.metricsIntervalSeconds));
      changes.metricsIntervalSeconds = input.metricsIntervalSeconds;
    }
    if (input.metricsRetentionDays !== undefined) {
      settingsRepository.set(KEY_RETENTION, String(input.metricsRetentionDays));
      changes.metricsRetentionDays = input.metricsRetentionDays;
    }

    // Apply the new interval to the running collector (retention is read fresh
    // on each sweep, so it needs no explicit reschedule).
    if (changes.metricsIntervalSeconds !== undefined) {
      metricsService.reschedule();
    }

    activityService.record({
      type: 'settings_changed',
      message: 'Updated application settings',
      username: req.session.user?.username ?? null,
      ipAddress: getClientIp(req),
      metadata: changes,
    });

    sendSuccess(res, readSettings());
  }),
};
