/**
 * Data access for the `sessions` table.
 *
 * The table itself is created and owned by better-sqlite3-session-store; here
 * we only provide the ability to revoke a user's sessions (e.g. when their
 * account is deleted) by matching the serialised session user id. Sessions are
 * stored as JSON in the `sess` column, shaped like `{"cookie":...,"user":{"id":N,...}}`.
 */
import { getDb } from '../db';

export const sessionRepository = {
  /**
   * Delete all sessions belonging to a given user id. Returns the number of
   * sessions removed. No-op (returns 0) if the session table does not yet exist.
   */
  deleteByUserId(userId: number): number {
    const db = getDb();
    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
      .get();
    if (!tableExists) return 0;

    // `userId` is an integer (validated upstream), so the interpolated pattern
    // cannot carry SQL; it is still passed as a bound parameter.
    const pattern = `%"user":{"id":${userId},%`;
    const result = db.prepare('DELETE FROM sessions WHERE sess LIKE ?').run(pattern);
    return result.changes;
  },
};
