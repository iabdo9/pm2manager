/**
 * Logs controller — real-time process log streaming over Server-Sent Events.
 *
 * The `stream` handler tails a single PM2 process's stdout/stderr. It first
 * validates the target exists (so a missing process yields a JSON 404 before
 * any SSE framing is written), optionally replays a short backlog read
 * directly from the process's log files, then subscribes to `pm2Service`'s
 * live `log` event stream. A periodic heartbeat keeps intermediaries from
 * closing the idle connection, and all resources are released when the client
 * disconnects. PM2 is never invoked via the shell.
 */
import type { RequestHandler, Response } from 'express';
import { open } from 'node:fs/promises';
import { pm2Service } from '../services/pm2.service';
import { asyncHandler } from '../utils/asyncHandler';
import { NotFoundError } from '../utils/errors';
import type { LogLine, ProcessDetail } from '../types';

/** How many trailing lines of each log file to replay when a client connects. */
const BACKLOG_LINES = 100;

/**
 * Cap on how many bytes are read from the end of a log file for the backlog.
 * PM2 does not rotate logs by default, so files can be huge — we only ever
 * read this much from the tail, keeping memory bounded and avoiding a blocking
 * full-file read.
 */
const BACKLOG_TAIL_BYTES = 128 * 1024;

/** Heartbeat interval (ms) — an SSE comment line that keeps the socket alive. */
const HEARTBEAT_MS = 25000;

/**
 * Interpret a route parameter as a PM2 target: an all-digit value is a numeric
 * `pm_id`, anything else is treated as a process name.
 */
function resolveTarget(idOrName: string): number | string {
  return /^\d+$/.test(idOrName) ? Number(idOrName) : idOrName;
}

/** Serialise a log line as a single SSE `data:` event. */
function writeLogEvent(res: Response, line: LogLine): void {
  res.write(`data: ${JSON.stringify(line)}\n\n`);
}

/**
 * Read up to the last `BACKLOG_LINES` non-empty lines from the tail of a file,
 * reading at most `BACKLOG_TAIL_BYTES` from the end. Returns `[]` on any error
 * (missing/unreadable file). Never loads the whole file into memory.
 */
async function readTailLines(path: string): Promise<string[]> {
  let handle;
  try {
    handle = await open(path, 'r');
    const { size } = await handle.stat();
    const start = Math.max(0, size - BACKLOG_TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return [];
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    // If we started mid-file, drop the first (likely partial) line.
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (start > 0 && lines.length) lines.shift();
    return lines.slice(-BACKLOG_LINES);
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Replay the last lines of the process's stdout and stderr log files. Files may
 * be absent or unreadable; any failure is ignored so the live stream can still
 * start. Reads only a bounded tail of each file (no blocking full-file read).
 */
async function sendBacklog(res: Response, proc: ProcessDetail): Promise<void> {
  const sources: Array<{ path: string | null; channel: 'out' | 'err' }> = [
    { path: proc.outLogPath, channel: 'out' },
    { path: proc.errorLogPath, channel: 'err' },
  ];

  for (const { path, channel } of sources) {
    if (!path) continue;
    const lines = await readTailLines(path);
    for (const message of lines) {
      writeLogEvent(res, {
        channel,
        processName: proc.name,
        pmId: proc.pmId,
        message,
        timestamp: Date.now(),
      });
    }
  }
}

/** Express handlers backing the `/api/processes/:idOrName/logs` routes. */
export const logsController: Record<'stream', RequestHandler> = {
  /** GET `/:idOrName/logs/stream` — tail a process's logs over SSE. */
  stream: asyncHandler(async (req, res) => {
    const target = resolveTarget(req.params.idOrName);
    const proc = await pm2Service.describe(target);
    if (!proc) throw new NotFoundError('Process not found');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    await sendBacklog(res, proc);
    // The client may have disconnected while we were reading the backlog.
    if (res.writableEnded) return;

    res.write('event: ready\ndata: {}\n\n');

    const onLog = (line: LogLine): void => {
      if (line.pmId === proc.pmId || line.processName === proc.name) {
        writeLogEvent(res, line);
      }
    };
    pm2Service.events.on('log', onLog);

    const hb = setInterval(() => {
      res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    req.on('close', () => {
      pm2Service.events.off('log', onLog);
      clearInterval(hb);
      res.end();
    });
  }),
};
