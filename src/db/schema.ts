/**
 * Database schema.
 *
 * The schema is expressed as idempotent `CREATE TABLE IF NOT EXISTS`
 * statements so that opening the database always brings it up to date.
 * The `sessions` table is created and owned by better-sqlite3-session-store,
 * so it is intentionally not declared here.
 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
  is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  username   TEXT,
  ip_address TEXT,
  metadata   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log (type);

CREATE TABLE IF NOT EXISTS metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pm_id         INTEGER NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL,
  cpu           REAL NOT NULL,
  memory        INTEGER NOT NULL,
  uptime        INTEGER NOT NULL,
  restart_count INTEGER NOT NULL,
  timestamp     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_name_ts ON metrics (name, timestamp DESC);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
