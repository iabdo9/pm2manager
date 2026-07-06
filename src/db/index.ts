/**
 * SQLite database connection (better-sqlite3).
 *
 * A single shared, synchronous connection is used across the app. WAL mode
 * is enabled for good read/write concurrency and durability. The connection
 * is created lazily on first access via `getDb()` and initialised (schema
 * applied) by `initDatabase()` during bootstrap.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config';
import { createLogger } from '../utils/logger';
import { SCHEMA_SQL } from './schema';

const log = createLogger('db');

let db: DatabaseType | null = null;

/**
 * Open (or return the already-open) database connection and ensure the
 * schema exists. Safe to call multiple times.
 */
export function initDatabase(): DatabaseType {
  if (db) return db;

  const dir = path.dirname(config.database.path);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.database.path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  db.exec(SCHEMA_SQL);

  log.info({ path: config.database.path }, 'Database initialised');
  return db;
}

/** Return the active database connection, initialising it if necessary. */
export function getDb(): DatabaseType {
  return db ?? initDatabase();
}

/** Close the database connection (used during graceful shutdown). */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    log.info('Database connection closed');
  }
}
