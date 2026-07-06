/**
 * Metrics collection service.
 *
 * Periodically samples the live PM2 process list and persists a snapshot of
 * each process's CPU/memory/uptime/restart figures into the `metrics` table so
 * that the history charts have data to draw. A separate, slower timer prunes
 * old metric samples and activity-log entries to keep the SQLite file bounded.
 *
 * Collection is deliberately fault-tolerant: if the PM2 daemon is unreachable
 * a sweep simply logs and returns rather than throwing, so a missing daemon can
 * never crash the host application.
 */
import { config } from '../config';
import { metricsRepository } from '../repositories/metrics.repository';
import { settingsRepository } from '../repositories/settings.repository';
import { activityService } from './activity.service';
import { pm2Service } from './pm2.service';
import type { MetricInput } from '../types';
import { createLogger } from '../utils/logger';

const log = createLogger('metrics');

/** Milliseconds in one day. */
const DAY_MS = 86_400_000;

/** How often the retention sweep runs (hourly). */
const RETENTION_INTERVAL_MS = 3_600_000;

/** Persisted settings keys (shared with the settings controller). */
const KEY_INTERVAL = 'metricsIntervalSeconds';
const KEY_RETENTION = 'metricsRetentionDays';

/**
 * Minimum number of days of activity-log history to keep, regardless of the
 * (potentially much shorter) metrics retention window.
 */
const MIN_ACTIVITY_RETENTION_DAYS = 30;

// Module-level timer handles so the service can be started/stopped idempotently.
let collectTimer: ReturnType<typeof setInterval> | null = null;
let retentionTimer: ReturnType<typeof setInterval> | null = null;

/** Parse a persisted numeric setting, falling back to a default. */
function numberSetting(key: string, fallback: number): number {
  const raw = settingsRepository.get(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Effective sampling interval (ms): a persisted `metricsIntervalSeconds`
 * overrides the env-derived default so admin changes actually take effect.
 */
function effectiveIntervalMs(): number {
  return numberSetting(KEY_INTERVAL, config.metrics.intervalMs / 1000) * 1000;
}

/** Effective retention window (days): persisted value overrides the default. */
function effectiveRetentionDays(): number {
  return numberSetting(KEY_RETENTION, config.metrics.retentionDays);
}

export const metricsService = {
  /**
   * Take a single metrics snapshot of all PM2 processes and persist it.
   *
   * Never throws: any failure (most commonly the PM2 daemon being down) is
   * logged and swallowed so the periodic timer stays healthy.
   */
  async collectOnce(): Promise<void> {
    try {
      const procs = await pm2Service.list();
      const ts = Date.now();
      const samples: MetricInput[] = procs.map((p) => ({
        pmId: p.pmId,
        name: p.name,
        status: p.status,
        cpu: p.cpu,
        memory: p.memory,
        uptime: p.uptime,
        restartCount: p.restartCount,
        timestamp: ts,
      }));
      metricsRepository.insertMany(samples);
    } catch (err) {
      log.error({ err }, 'Metrics collection failed');
    }
  },

  /**
   * Delete metric samples and activity-log entries older than the configured
   * retention window. Logs how many rows were removed.
   */
  runRetention(): void {
    const retentionDays = effectiveRetentionDays();
    const metricsRemoved = metricsRepository.deleteOlderThan(Date.now() - retentionDays * DAY_MS);
    const activityDays = Math.max(retentionDays * 4, MIN_ACTIVITY_RETENTION_DAYS);
    const activityRemoved = activityService.prune(activityDays);
    log.info({ metricsRemoved, activityRemoved, retentionDays }, 'Retention sweep complete');
  },

  /** Effective retention window in days (persisted setting or config default). */
  getRetentionDays(): number {
    return effectiveRetentionDays();
  },

  /**
   * Begin periodic collection and retention. Collects immediately, then on the
   * effective interval. Guards against being started twice.
   */
  start(): void {
    if (collectTimer) {
      log.warn('Metrics service already started; ignoring start()');
      return;
    }
    const intervalMs = effectiveIntervalMs();
    void this.collectOnce();
    collectTimer = setInterval(() => void this.collectOnce(), intervalMs);
    retentionTimer = setInterval(() => this.runRetention(), RETENTION_INTERVAL_MS);
    log.info({ intervalMs, retentionDays: effectiveRetentionDays() }, 'Metrics service started');
  },

  /**
   * Re-read the persisted settings and restart the collection timer so a
   * changed sampling interval takes effect immediately (called after the
   * settings are updated). No-op if the service has not been started.
   */
  reschedule(): void {
    if (!collectTimer) return;
    clearInterval(collectTimer);
    const intervalMs = effectiveIntervalMs();
    collectTimer = setInterval(() => void this.collectOnce(), intervalMs);
    log.info({ intervalMs }, 'Metrics collection rescheduled');
  },

  /** Stop periodic collection and retention, clearing both timers. */
  stop(): void {
    if (collectTimer) {
      clearInterval(collectTimer);
      collectTimer = null;
    }
    if (retentionTimer) {
      clearInterval(retentionTimer);
      retentionTimer = null;
    }
    log.info('Metrics service stopped');
  },
};
