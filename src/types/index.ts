/**
 * Shared domain types used across the whole application.
 *
 * These types form the contract between the data layer (repositories),
 * the business layer (services), the transport layer (controllers/routes)
 * and, ultimately, the JSON shapes consumed by the browser client.
 *
 * Keep this file free of runtime imports so it can be shared everywhere
 * without creating circular dependencies.
 */

// ---------------------------------------------------------------------------
// Users & authentication
// ---------------------------------------------------------------------------

/** A user row exactly as stored in the database. */
export interface UserRecord {
  id: number;
  username: string;
  /** Argon2 password hash. Never sent to the client. */
  password_hash: string;
  /** Base32 TOTP secret, or null when 2FA is not enabled. Never sent to the client. */
  totp_secret: string | null;
  /** 1 when TOTP two-factor auth is active for this user, else 0. */
  totp_enabled: 0 | 1;
  /** 1 for administrators (may manage other users), else 0. */
  is_admin: 0 | 1;
  created_at: string;
  updated_at: string;
}

/** A user safe to expose over the API (no secrets). */
export interface PublicUser {
  id: number;
  username: string;
  totpEnabled: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Shape of data persisted in the session for an authenticated user. */
export interface SessionUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/**
 * Categories of auditable events. Kept as a string union so it is both
 * type-safe in code and stored as a readable value in SQLite.
 */
export type ActivityType =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'twofa_enabled'
  | 'twofa_disabled'
  | 'password_changed'
  | 'user_created'
  | 'user_deleted'
  | 'settings_changed'
  | 'process_start'
  | 'process_stop'
  | 'process_restart'
  | 'process_reload'
  | 'process_delete'
  | 'process_start_all'
  | 'process_stop_all'
  | 'process_restart_all'
  | 'process_reload_all'
  | 'process_event';

export interface ActivityRecord {
  id: number;
  type: ActivityType;
  /** Human-readable summary of what happened. */
  message: string;
  /** Username associated with the event, or null for system events. */
  username: string | null;
  /** Originating IP address, when known. */
  ip_address: string | null;
  /** Optional JSON string with extra structured detail. */
  metadata: string | null;
  created_at: string;
}

/** Input used to create a new activity log entry. */
export interface ActivityInput {
  type: ActivityType;
  message: string;
  username?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Metrics history
// ---------------------------------------------------------------------------

/** A single sampled metrics row for one PM2 process at one point in time. */
export interface MetricRecord {
  id: number;
  /** PM2 pm_id of the process at sample time. */
  pm_id: number;
  name: string;
  status: string;
  cpu: number;
  /** Memory in bytes. */
  memory: number;
  /** Uptime in milliseconds at sample time (0 when not online). */
  uptime: number;
  restart_count: number;
  /** Unix epoch milliseconds when the sample was taken. */
  timestamp: number;
}

/** Input used to insert a metrics sample. */
export interface MetricInput {
  pmId: number;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restartCount: number;
  timestamp: number;
}

/** One point in a time-series query result (for charts). */
export interface MetricPoint {
  timestamp: number;
  cpu: number;
  memory: number;
  status: string;
  restartCount: number;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** A generic key/value application setting stored in SQLite. */
export interface SettingRecord {
  key: string;
  value: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// PM2 process model (normalised from the PM2 API `describe`/`list` output)
// ---------------------------------------------------------------------------

export type ProcessStatus =
  | 'online'
  | 'stopping'
  | 'stopped'
  | 'launching'
  | 'errored'
  | 'one-launch-status'
  | 'unknown';

/** Compact process shape used by list/dashboard views. */
export interface ProcessSummary {
  pmId: number;
  name: string;
  namespace: string;
  status: ProcessStatus;
  pid: number | null;
  cpu: number;
  /** Memory in bytes. */
  memory: number;
  /** Uptime in milliseconds (0 when not online). */
  uptime: number;
  /** Wall-clock ms timestamp the process was last started (pm_uptime). */
  pmUptime: number | null;
  restartCount: number;
  unstableRestarts: number;
  instances: number;
  execMode: string;
  version: string | null;
  user: string | null;
  watching: boolean;
  autorestart: boolean;
}

/** Full process shape used by the detail view (extends the summary). */
export interface ProcessDetail extends ProcessSummary {
  script: string | null;
  cwd: string | null;
  interpreter: string | null;
  nodeArgs: string[];
  args: string[];
  execPath: string | null;
  outLogPath: string | null;
  errorLogPath: string | null;
  pidPath: string | null;
  createdAt: number | null;
  /** Process environment variables (sensitive values may be present). */
  env: Record<string, string>;
}

/** Actions that can be performed on a single process. */
export type ProcessAction = 'start' | 'stop' | 'restart' | 'reload' | 'delete';

/** Bulk actions performed on all processes. */
export type BulkProcessAction = 'startAll' | 'stopAll' | 'restartAll' | 'reloadAll';

/** Status of the PM2 daemon / connection. */
export interface DaemonStatus {
  connected: boolean;
  /** PM2 version reported by the daemon, when available. */
  version: string | null;
  /** Number of processes currently managed by PM2. */
  processCount: number;
}

// ---------------------------------------------------------------------------
// Dashboard & system information
// ---------------------------------------------------------------------------

export interface SystemInfo {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  /** OS uptime in seconds. */
  uptime: number;
  /** Number of logical CPU cores. */
  cpuCount: number;
  cpuModel: string;
  /** Total system memory in bytes. */
  totalMemory: number;
  /** Free system memory in bytes. */
  freeMemory: number;
  loadAverage: [number, number, number];
  nodeVersion: string;
  appUptime: number;
}

export interface DashboardSummary {
  totalProcesses: number;
  onlineProcesses: number;
  stoppedProcesses: number;
  erroredProcesses: number;
  /** Sum of per-process CPU percentages. */
  totalCpu: number;
  /** Sum of per-process memory usage in bytes. */
  totalMemory: number;
  totalRestarts: number;
  daemon: DaemonStatus;
  system: SystemInfo;
  recentActivity: ActivityRecord[];
  recentRestarts: ActivityRecord[];
}

// ---------------------------------------------------------------------------
// Log streaming
// ---------------------------------------------------------------------------

export interface LogLine {
  /** 'out' for stdout, 'err' for stderr. */
  channel: 'out' | 'err';
  processName: string;
  pmId: number;
  message: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Generic API envelope
// ---------------------------------------------------------------------------

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    message: string;
    code: string;
    /** Optional field-level validation issues. */
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
