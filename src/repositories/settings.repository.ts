/**
 * Data access for the `settings` key/value table.
 */
import { getDb } from '../db';
import type { SettingRecord } from '../types';

export const settingsRepository = {
  get(key: string): string | undefined {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  },

  getAll(): SettingRecord[] {
    return getDb().prepare('SELECT * FROM settings ORDER BY key').all() as SettingRecord[];
  },

  set(key: string, value: string): void {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run(key, value);
  },

  delete(key: string): void {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
  },
};
