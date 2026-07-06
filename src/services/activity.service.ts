/**
 * Activity/audit logging service.
 *
 * Central place for recording auditable events. Every important action in the
 * app (auth events, process operations, config changes) flows through here so
 * that the storage format (JSON-serialised metadata) stays consistent.
 */
import { activityRepository } from '../repositories/activity.repository';
import type { ActivityInput, ActivityRecord, ActivityType } from '../types';
import { createLogger } from '../utils/logger';

const log = createLogger('activity');

/** Activity types that represent a process restart/reload (for "recent restarts"). */
const RESTART_TYPES: ActivityType[] = [
  'process_restart',
  'process_reload',
  'process_restart_all',
  'process_reload_all',
];

export const activityService = {
  /**
   * Record an activity event. Never throws — audit logging must not break the
   * request it is attached to; failures are logged and swallowed.
   */
  record(input: ActivityInput): void {
    try {
      activityRepository.create({
        type: input.type,
        message: input.message,
        username: input.username ?? null,
        ipAddress: input.ipAddress ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      });
    } catch (err) {
      log.error({ err, type: input.type }, 'Failed to record activity');
    }
  },

  list(options: { limit?: number; offset?: number; type?: ActivityType } = {}): ActivityRecord[] {
    return activityRepository.list(options);
  },

  count(type?: ActivityType): number {
    return activityRepository.count(type ? { type } : {});
  },

  recent(limit = 10): ActivityRecord[] {
    return activityRepository.list({ limit });
  },

  recentRestarts(limit = 10): ActivityRecord[] {
    return activityRepository.list({ limit, types: RESTART_TYPES });
  },

  /** Remove entries older than `days` days. Returns rows removed. */
  prune(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS"; align the cutoff.
    const sqliteCutoff = cutoff.replace('T', ' ').slice(0, 19);
    return activityRepository.deleteOlderThan(sqliteCutoff);
  },
};
