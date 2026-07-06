/**
 * Dashboard aggregation service.
 *
 * Builds the single `DashboardSummary` payload consumed by the dashboard view
 * by combining the live PM2 process list, the daemon status, host/system
 * information and recent audit-log activity into one object.
 *
 * The process list is fetched defensively: if the PM2 daemon is unavailable the
 * summary still renders (with zeroed process totals) rather than failing.
 */
import { activityService } from './activity.service';
import { pm2Service } from './pm2.service';
import { systemService } from './system.service';
import type { DashboardSummary, ProcessSummary } from '../types';

export const dashboardService = {
  /** Assemble the full dashboard summary. */
  async getSummary(): Promise<DashboardSummary> {
    let processes: ProcessSummary[] = [];
    try {
      processes = await pm2Service.list();
    } catch {
      processes = [];
    }

    const daemon = await pm2Service.getDaemonStatus();
    const system = systemService.getInfo();

    const totalProcesses = processes.length;
    const onlineProcesses = processes.filter((p) => p.status === 'online').length;
    const stoppedProcesses = processes.filter((p) => p.status === 'stopped').length;
    const erroredProcesses = processes.filter((p) => p.status === 'errored').length;
    const totalCpu = processes.reduce((sum, p) => sum + p.cpu, 0);
    const totalMemory = processes.reduce((sum, p) => sum + p.memory, 0);
    const totalRestarts = processes.reduce((sum, p) => sum + p.restartCount, 0);

    return {
      totalProcesses,
      onlineProcesses,
      stoppedProcesses,
      erroredProcesses,
      totalCpu,
      totalMemory,
      totalRestarts,
      daemon,
      system,
      recentActivity: activityService.recent(10),
      recentRestarts: activityService.recentRestarts(10),
    };
  },
};
