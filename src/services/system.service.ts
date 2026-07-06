/**
 * System information service — exposes host/OS metrics for the dashboard.
 * Uses Node's built-in `os` module only (no shell commands).
 */
import os from 'node:os';
import type { SystemInfo } from '../types';

/** Process start time, captured at module load, for the app-uptime figure. */
const APP_START = process.hrtime.bigint();

export const systemService = {
  getInfo(): SystemInfo {
    const cpus = os.cpus();
    const load = os.loadavg();
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      uptime: Math.floor(os.uptime()),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      loadAverage: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
      nodeVersion: process.version,
      appUptime: Number((process.hrtime.bigint() - APP_START) / 1_000_000_000n),
    };
  },
};
