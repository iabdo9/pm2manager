/**
 * PM2 service — the single gateway to the PM2 daemon.
 *
 * All interaction with PM2 goes through the official `pm2` npm package's
 * programmatic API (no shell commands). The callback-based API is wrapped in
 * promises and PM2's raw `ProcessDescription` objects are normalised into the
 * strongly-typed `ProcessSummary` / `ProcessDetail` shapes used everywhere
 * else in the app.
 *
 * A single long-lived connection to the daemon is maintained. `launchBus` is
 * used to receive real-time log output and process lifecycle events, which are
 * re-emitted on `pm2Service.events` for consumers (log streaming, activity
 * logging) without coupling this module to those features.
 */
import { EventEmitter } from 'node:events';
import type { Proc, ProcessDescription } from 'pm2';
import pm2Module from 'pm2';
import { Pm2Error } from '../utils/errors';
import { createLogger } from '../utils/logger';
import type {
  DaemonStatus,
  LogLine,
  ProcessDetail,
  ProcessStatus,
  ProcessSummary,
} from '../types';

const log = createLogger('pm2');

/** Give up waiting for a PM2 daemon connection after this long. */
const CONNECT_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Typed facade over the (partially-typed) pm2 module.
// ---------------------------------------------------------------------------

type ErrCb = (err: Error | null) => void;
type ProcCb = (err: Error | null, proc: Proc) => void;
type ListCb = (err: Error | null, list: ProcessDescription[]) => void;

interface Pm2Bus {
  on(event: string, handler: (packet: unknown) => void): void;
  close?(): void;
}

interface Pm2Facade {
  connect(cb: ErrCb): void;
  disconnect(): void;
  list(cb: ListCb): void;
  describe(proc: string | number, cb: ListCb): void;
  start(proc: string | number, cb: ProcCb): void;
  stop(proc: string | number, cb: ProcCb): void;
  restart(proc: string | number, cb: ProcCb): void;
  reload(proc: string | number, cb: ProcCb): void;
  delete(proc: string | number, cb: ProcCb): void;
  launchBus(cb: (err: Error | null, bus: Pm2Bus) => void): void;
}

const pm2 = pm2Module as unknown as Pm2Facade;

/**
 * The runtime `pm2_env` object contains far more than the published typings:
 * user-provided environment variables are spread onto it alongside PM2's own
 * metadata. We access those extra fields through this loose view.
 */
type RawPm2Env = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Environment-variable extraction
// ---------------------------------------------------------------------------

/** Exact PM2-internal keys that are metadata, not user environment variables. */
const ENV_BLOCKLIST = new Set<string>([
  'name', 'namespace', 'version', 'versioning', 'status', 'pm_id', 'pm_pid_path',
  'pm_exec_path', 'pm_cwd', 'pm_out_log_path', 'pm_err_log_path', 'pm_uptime',
  'exec_interpreter', 'exec_mode', 'instances', 'node_args', 'args', 'watch',
  'autorestart', 'autostart', 'vizion', 'vizion_running', 'merge_logs', 'created_at',
  'restart_time', 'unstable_restarts', 'prev_restart_delay', 'kill_retry_time',
  'windowsHide', 'treekill', 'automation', 'pmx', 'instance_var', 'filter_env',
  'watch_options', 'ignore_watch', 'source_map_support', 'disable_source_map_support',
  'username', 'env', 'command', 'axm_actions', 'axm_monitor', 'axm_options',
  'axm_dynamic', 'error', 'started_inside', 'wait_ready', 'max_memory_restart',
  'min_uptime', 'max_restarts', 'restart_delay', 'kill_timeout', 'time',
  'exit_code', 'unique_id', 'node_version', 'io', 'PM2_HOME',
]);

/** Prefixes that mark internal PM2 / monitoring keys. */
const ENV_PREFIX_BLOCKLIST = ['pm_', 'PM2_', 'axm_', 'km_', '_'];

function isEnvKey(key: string): boolean {
  if (ENV_BLOCKLIST.has(key)) return false;
  return !ENV_PREFIX_BLOCKLIST.some((p) => key.startsWith(p));
}

function extractEnv(pm2Env: RawPm2Env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(pm2Env)) {
    if (!isEnvKey(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      env[key] = String(value);
    }
  }
  return env;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

function toProcessSummary(desc: ProcessDescription): ProcessSummary {
  const env = (desc.pm2_env ?? {}) as RawPm2Env;
  const status = (env.status as ProcessStatus) ?? 'unknown';
  const pmUptime = typeof env.pm_uptime === 'number' ? env.pm_uptime : null;
  const uptime = status === 'online' && pmUptime ? Math.max(0, Date.now() - pmUptime) : 0;
  const instances = typeof env.instances === 'number' ? env.instances : 1;

  return {
    pmId: desc.pm_id ?? -1,
    name: desc.name ?? 'unknown',
    namespace: (env.namespace as string) ?? 'default',
    status,
    pid: desc.pid && desc.pid > 0 ? desc.pid : null,
    cpu: desc.monit?.cpu ?? 0,
    memory: desc.monit?.memory ?? 0,
    uptime,
    pmUptime,
    restartCount: typeof env.restart_time === 'number' ? env.restart_time : 0,
    unstableRestarts: typeof env.unstable_restarts === 'number' ? env.unstable_restarts : 0,
    instances,
    execMode: (env.exec_mode as string) ?? 'fork',
    version: (env.version as string) ?? null,
    user: (env.username as string) ?? (env.USER as string) ?? null,
    watching: Boolean(env.watch),
    autorestart: env.autorestart !== false,
  };
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function toProcessDetail(desc: ProcessDescription): ProcessDetail {
  const summary = toProcessSummary(desc);
  const env = (desc.pm2_env ?? {}) as RawPm2Env;
  return {
    ...summary,
    script: (env.pm_exec_path as string) ?? null,
    cwd: (env.pm_cwd as string) ?? null,
    interpreter: (env.exec_interpreter as string) ?? null,
    nodeArgs: toStringArray(env.node_args),
    args: toStringArray(env.args),
    execPath: (env.pm_exec_path as string) ?? null,
    outLogPath: (env.pm_out_log_path as string) ?? null,
    errorLogPath: (env.pm_err_log_path as string) ?? null,
    pidPath: (env.pm_pid_path as string) ?? null,
    createdAt: typeof env.created_at === 'number' ? env.created_at : null,
    env: extractEnv(env),
  };
}

// ---------------------------------------------------------------------------
// Promise wrappers
// ---------------------------------------------------------------------------

function pList(): Promise<ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => (err ? reject(err) : resolve(list ?? [])));
  });
}

function pDescribe(idOrName: string | number): Promise<ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    pm2.describe(idOrName, (err, list) => (err ? reject(err) : resolve(list ?? [])));
  });
}

type SingleAction = 'start' | 'stop' | 'restart' | 'reload' | 'delete';

function pAction(action: SingleAction, idOrName: string | number): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2[action](idOrName, (err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class Pm2Service {
  /** Emits 'log' (LogLine) and 'process' ({ event, name, pmId }) events. */
  public readonly events = new EventEmitter();

  private connected = false;
  private connecting: Promise<void> | null = null;
  private bus: Pm2Bus | null = null;
  private busInitializing: Promise<void> | null = null;

  constructor() {
    // Many concurrent log streams may subscribe to the shared 'log' event;
    // lift the default 10-listener cap to avoid MaxListenersExceededWarning.
    this.events.setMaxListeners(64);
  }

  /** Establish (or reuse) the connection to the PM2 daemon. */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      // The PM2 socket layer can, in broken environments, fail to invoke the
      // callback (or only surface the failure as an async socket error). Guard
      // with a timeout so bootstrap never hangs waiting for a dead daemon.
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.connecting = null;
        reject(new Pm2Error('Timed out connecting to the PM2 daemon'));
      }, CONNECT_TIMEOUT_MS);
      timer.unref();

      pm2.connect((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connecting = null;
        if (err) {
          reject(new Pm2Error('Could not connect to the PM2 daemon', String(err.message ?? err)));
          return;
        }
        this.connected = true;
        log.info('Connected to PM2 daemon');
        resolve();
      });
    });
    return this.connecting;
  }

  disconnect(): void {
    if (this.bus?.close) {
      try {
        this.bus.close();
      } catch {
        /* ignore */
      }
      this.bus = null;
    }
    if (this.connected) {
      pm2.disconnect();
      this.connected = false;
      log.info('Disconnected from PM2 daemon');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect();
    // Best-effort (re)attach of the event bus so live log streaming and
    // process-event auditing keep working even if the bus was unavailable at
    // startup or dropped later. A bus failure must never fail the operation.
    if (this.connected && !this.bus) {
      try {
        await this.attachBus();
      } catch (err) {
        log.debug({ err }, 'PM2 event bus attach deferred; will retry');
      }
    }
  }

  /** Wrap PM2 rejections in a consistent Pm2Error. */
  private async guarded<T>(op: () => Promise<T>, message: string): Promise<T> {
    await this.ensureConnected();
    try {
      return await op();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Pm2Error(message, detail);
    }
  }

  async getDaemonStatus(): Promise<DaemonStatus> {
    try {
      const list = await this.guarded(() => pList(), 'Failed to query PM2');
      return {
        connected: this.connected,
        version: PM2_VERSION,
        processCount: list.length,
      };
    } catch {
      return { connected: false, version: PM2_VERSION, processCount: 0 };
    }
  }

  async list(): Promise<ProcessSummary[]> {
    const list = await this.guarded(() => pList(), 'Failed to list PM2 processes');
    return list.map(toProcessSummary).sort((a, b) => a.pmId - b.pmId);
  }

  async describe(idOrName: string | number): Promise<ProcessDetail | null> {
    const list = await this.guarded(
      () => pDescribe(idOrName),
      `Failed to describe process "${idOrName}"`,
    );
    const first = list[0];
    return first ? toProcessDetail(first) : null;
  }

  start(idOrName: string | number): Promise<void> {
    return this.guarded(() => pAction('start', idOrName), `Failed to start "${idOrName}"`);
  }

  stop(idOrName: string | number): Promise<void> {
    return this.guarded(() => pAction('stop', idOrName), `Failed to stop "${idOrName}"`);
  }

  restart(idOrName: string | number): Promise<void> {
    return this.guarded(() => pAction('restart', idOrName), `Failed to restart "${idOrName}"`);
  }

  reload(idOrName: string | number): Promise<void> {
    return this.guarded(() => pAction('reload', idOrName), `Failed to reload "${idOrName}"`);
  }

  remove(idOrName: string | number): Promise<void> {
    return this.guarded(() => pAction('delete', idOrName), `Failed to delete "${idOrName}"`);
  }

  /**
   * Apply a bulk action to every process. PM2 errors if asked to act on "all"
   * when no processes exist, so we short-circuit to a no-op in that case
   * (clicking "Restart all" with nothing running should succeed quietly).
   */
  private async bulk(action: 'stop' | 'restart' | 'reload', verb: string): Promise<void> {
    const procs = await this.list();
    if (procs.length === 0) return;
    await this.guarded(() => pAction(action, 'all'), `Failed to ${verb} all processes`);
  }

  stopAll(): Promise<void> {
    return this.bulk('stop', 'stop');
  }

  restartAll(): Promise<void> {
    return this.bulk('restart', 'restart');
  }

  reloadAll(): Promise<void> {
    return this.bulk('reload', 'reload');
  }

  /**
   * Start all currently-stopped processes. PM2 has no single "start all"
   * primitive, so we bring up each process that is not already online by
   * restarting it (restart starts a stopped process).
   */
  async startAll(): Promise<void> {
    const procs = await this.list();
    const stopped = procs.filter((p) => p.status !== 'online' && p.status !== 'launching');
    await Promise.all(
      stopped.map((p) =>
        this.guarded(() => pAction('restart', p.pmId), `Failed to start "${p.name}"`),
      ),
    );
  }

  /**
   * Ensure the PM2 daemon connection and event bus are established. Safe to
   * call repeatedly; used at startup to attach the bus eagerly. Bus attachment
   * is retried automatically on later operations if it is not ready yet.
   */
  async initBus(): Promise<void> {
    await this.ensureConnected();
  }

  /**
   * Launch the PM2 event bus and re-emit its log/process events. In-flight
   * guarded and idempotent (returns immediately if the bus is already up). The
   * bus reference is cleared on 'close'/'error' so `ensureConnected` re-attaches
   * it — this is what keeps live streaming alive across daemon hiccups.
   */
  private attachBus(): Promise<void> {
    if (this.bus) return Promise.resolve();
    if (this.busInitializing) return this.busInitializing;

    this.busInitializing = new Promise<void>((resolve, reject) => {
      pm2.launchBus((err, bus) => {
        this.busInitializing = null;
        if (err) {
          reject(new Pm2Error('Failed to launch PM2 event bus', String(err.message ?? err)));
          return;
        }
        this.bus = bus;

        const emitLog = (channel: 'out' | 'err') => (packet: unknown) => {
          const p = packet as {
            process?: { name?: string; pm_id?: number };
            data?: string;
            at?: number;
          };
          const line: LogLine = {
            channel,
            processName: p.process?.name ?? 'unknown',
            pmId: p.process?.pm_id ?? -1,
            message: typeof p.data === 'string' ? p.data : String(p.data ?? ''),
            timestamp: p.at ?? Date.now(),
          };
          this.events.emit('log', line);
        };

        bus.on('log:out', emitLog('out'));
        bus.on('log:err', emitLog('err'));

        bus.on('process:event', (packet: unknown) => {
          const p = packet as {
            event?: string;
            process?: { name?: string; pm_id?: number };
          };
          this.events.emit('process', {
            event: p.event ?? 'unknown',
            name: p.process?.name ?? 'unknown',
            pmId: p.process?.pm_id ?? -1,
          });
        });

        // Drop the reference on failure so it is re-attached on the next op.
        bus.on('close', () => {
          this.bus = null;
        });
        bus.on('error', (e: unknown) => {
          log.warn({ err: e }, 'PM2 event bus error; will re-attach');
          this.bus = null;
        });

        log.info('PM2 event bus attached');
        resolve();
      });
    });
    return this.busInitializing;
  }
}

/** Version of the installed pm2 package, reported as the daemon version. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PM2_VERSION: string | null = (() => {
  try {
    return (require('pm2/package.json') as { version: string }).version;
  } catch {
    return null;
  }
})();

export const pm2Service = new Pm2Service();

/** Shape of a 'process' event emitted on `pm2Service.events`. */
export interface Pm2ProcessEvent {
  event: string;
  name: string;
  pmId: number;
}
