/**
 * Data access for the `activity_log` table.
 */
import { getDb } from '../db';
import type { ActivityRecord, ActivityType } from '../types';

export interface CreateActivityData {
  type: ActivityType;
  message: string;
  username: string | null;
  ipAddress: string | null;
  /** Pre-serialised JSON string, or null. */
  metadata: string | null;
}

export interface ActivityQuery {
  limit?: number;
  offset?: number;
  type?: ActivityType;
  /** Restrict to a set of activity types (used for "recent restarts"). */
  types?: ActivityType[];
}

export const activityRepository = {
  create(data: CreateActivityData): ActivityRecord {
    const result = getDb()
      .prepare(
        `INSERT INTO activity_log (type, message, username, ip_address, metadata)
         VALUES (@type, @message, @username, @ipAddress, @metadata)`,
      )
      .run(data);
    return getDb()
      .prepare('SELECT * FROM activity_log WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as ActivityRecord;
  },

  list(query: ActivityQuery = {}): ActivityRecord[] {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.type) {
      conditions.push('type = ?');
      params.push(query.type);
    }
    if (query.types && query.types.length > 0) {
      conditions.push(`type IN (${query.types.map(() => '?').join(', ')})`);
      params.push(...query.types);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    return getDb()
      .prepare(
        `SELECT * FROM activity_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params) as ActivityRecord[];
  },

  count(query: Pick<ActivityQuery, 'type'> = {}): number {
    if (query.type) {
      const row = getDb()
        .prepare('SELECT COUNT(*) AS n FROM activity_log WHERE type = ?')
        .get(query.type) as { n: number };
      return row.n;
    }
    const row = getDb().prepare('SELECT COUNT(*) AS n FROM activity_log').get() as { n: number };
    return row.n;
  },

  /** Delete entries older than the given ISO timestamp. Returns rows removed. */
  deleteOlderThan(isoTimestamp: string): number {
    const result = getDb()
      .prepare('DELETE FROM activity_log WHERE created_at < ?')
      .run(isoTimestamp);
    return result.changes;
  },
};
