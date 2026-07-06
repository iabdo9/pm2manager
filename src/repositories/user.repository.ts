/**
 * Data access for the `users` table. Repositories contain SQL only — no
 * business logic (hashing, validation, etc. live in the services).
 */
import type { Statement } from 'better-sqlite3';
import { getDb } from '../db';
import type { UserRecord } from '../types';

export interface CreateUserData {
  username: string;
  passwordHash: string;
  isAdmin: boolean;
}

export const userRepository = {
  countAll(): number {
    const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return row.n;
  },

  findById(id: number): UserRecord | undefined {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
  },

  findByUsername(username: string): UserRecord | undefined {
    return getDb()
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as UserRecord | undefined;
  },

  listAll(): UserRecord[] {
    return getDb().prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as UserRecord[];
  },

  create(data: CreateUserData): UserRecord {
    const stmt: Statement = getDb().prepare(
      `INSERT INTO users (username, password_hash, is_admin)
       VALUES (@username, @passwordHash, @isAdmin)`,
    );
    const result = stmt.run({
      username: data.username,
      passwordHash: data.passwordHash,
      isAdmin: data.isAdmin ? 1 : 0,
    });
    return this.findById(Number(result.lastInsertRowid))!;
  },

  updatePassword(id: number, passwordHash: string): void {
    getDb()
      .prepare(
        `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(passwordHash, id);
  },

  setTotp(id: number, secret: string | null, enabled: boolean): void {
    getDb()
      .prepare(
        `UPDATE users
         SET totp_secret = ?, totp_enabled = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(secret, enabled ? 1 : 0, id);
  },

  delete(id: number): void {
    getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  },
};
