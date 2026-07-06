/**
 * Process controller — REST handlers for managing PM2 processes.
 *
 * Exposes listing, per-process detail, single-process lifecycle actions
 * (start/stop/restart/reload), deletion, and bulk "all processes" actions.
 * All PM2 access is delegated to `pm2Service`; every mutating action is
 * recorded through `activityService` for the audit log. Handlers respond
 * exclusively through `sendSuccess` and signal failures by throwing typed
 * errors so the central error middleware can shape the response.
 */
import type { RequestHandler } from 'express';
import { pm2Service } from '../services/pm2.service';
import { activityService } from '../services/activity.service';
import { getClientIp } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { NotFoundError } from '../utils/errors';
import type { ActivityType } from '../types';

/** Single-process lifecycle actions accepted on the route. */
type SingleAction = 'start' | 'stop' | 'restart' | 'reload';

/** Bulk "all processes" actions accepted on the route. */
type BulkActionParam = 'start-all' | 'stop-all' | 'restart-all' | 'reload-all';

/**
 * Interpret a route parameter as a PM2 target: an all-digit value is a numeric
 * `pm_id`, anything else is treated as a process name.
 */
function resolveTarget(idOrName: string): number | string {
  return /^\d+$/.test(idOrName) ? Number(idOrName) : idOrName;
}

/** Mapping of each single action to its PM2 call, activity type and verb. */
const SINGLE_ACTION_CONFIG: Record<
  SingleAction,
  { run: (target: number | string) => Promise<void>; type: ActivityType; verb: string }
> = {
  start: { run: (t) => pm2Service.start(t), type: 'process_start', verb: 'started' },
  stop: { run: (t) => pm2Service.stop(t), type: 'process_stop', verb: 'stopped' },
  restart: { run: (t) => pm2Service.restart(t), type: 'process_restart', verb: 'restarted' },
  reload: { run: (t) => pm2Service.reload(t), type: 'process_reload', verb: 'reloaded' },
};

/** Mapping of each bulk action to its PM2 call, activity type and verb. */
const BULK_ACTION_CONFIG: Record<
  BulkActionParam,
  { run: () => Promise<void>; type: ActivityType; verb: string }
> = {
  'start-all': { run: () => pm2Service.startAll(), type: 'process_start_all', verb: 'started' },
  'stop-all': { run: () => pm2Service.stopAll(), type: 'process_stop_all', verb: 'stopped' },
  'restart-all': {
    run: () => pm2Service.restartAll(),
    type: 'process_restart_all',
    verb: 'restarted',
  },
  'reload-all': { run: () => pm2Service.reloadAll(), type: 'process_reload_all', verb: 'reloaded' },
};

/** Express handlers backing the `/api/processes` routes. */
export const processController: Record<
  'list' | 'detail' | 'action' | 'remove' | 'bulkAction',
  RequestHandler
> = {
  /** GET `/` — list all PM2 processes. */
  list: asyncHandler(async (_req, res) => {
    const processes = await pm2Service.list();
    sendSuccess(res, { processes });
  }),

  /** GET `/:idOrName` — full detail for one process (404 when missing). */
  detail: asyncHandler(async (req, res) => {
    const target = resolveTarget(req.params.idOrName);
    const p = await pm2Service.describe(target);
    if (!p) throw new NotFoundError('Process not found');
    sendSuccess(res, { process: p });
  }),

  /** POST `/:idOrName/:action` — perform a single lifecycle action. */
  action: asyncHandler(async (req, res) => {
    const target = resolveTarget(req.params.idOrName);
    const action = req.params.action as SingleAction;
    const cfg = SINGLE_ACTION_CONFIG[action];

    await cfg.run(target);

    activityService.record({
      type: cfg.type,
      message: `Process "${target}" ${cfg.verb}`,
      username: req.session.user?.username ?? null,
      ipAddress: getClientIp(req),
      metadata: { target },
    });

    sendSuccess(res, {});
  }),

  /** DELETE `/:idOrName` — remove a process from PM2. */
  remove: asyncHandler(async (req, res) => {
    const target = resolveTarget(req.params.idOrName);

    await pm2Service.remove(target);

    activityService.record({
      type: 'process_delete',
      message: `Process "${target}" deleted`,
      username: req.session.user?.username ?? null,
      ipAddress: getClientIp(req),
      metadata: { target },
    });

    sendSuccess(res, {});
  }),

  /** POST `/actions/:action` — perform a bulk action across all processes. */
  bulkAction: asyncHandler(async (req, res) => {
    const action = req.params.action as BulkActionParam;
    const cfg = BULK_ACTION_CONFIG[action];

    await cfg.run();

    activityService.record({
      type: cfg.type,
      message: `All processes ${cfg.verb}`,
      username: req.session.user?.username ?? null,
      ipAddress: getClientIp(req),
      metadata: { action },
    });

    sendSuccess(res, {});
  }),
};
