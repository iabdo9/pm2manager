/**
 * History controller — time-series metrics for the history charts.
 *
 * `series` returns either a per-process series (when a `name` is given) or the
 * aggregated across-all-processes series, bounded by an explicit since/until or
 * a shorthand `range`. `names` lists the process names that have samples within
 * the retention window (used to populate the chart's process selector).
 */
import { metricsRepository } from '../repositories/metrics.repository';
import { metricsService } from '../services/metrics.service';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import type { HistoryQuery } from '../validation/schemas';

/** Milliseconds in one day. */
const DAY_MS = 86_400_000;

/** Duration (ms) represented by each shorthand `range` value. */
const RANGE_MS: Record<HistoryQuery['range'], number> = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
};

export const historyController = {
  /**
   * GET /api/history — return a metrics time-series.
   * Query is pre-validated by `historyQuerySchema`.
   */
  series: asyncHandler(async (req, res) => {
    const query = req.query as unknown as HistoryQuery;
    const until = query.until ?? Date.now();
    const since = query.since ?? until - RANGE_MS[query.range];

    if (query.name) {
      const points = metricsRepository.seriesForProcess(query.name, since, until);
      sendSuccess(res, { name: query.name, since, until, points });
    } else {
      const points = metricsRepository.aggregateSeries(since, until);
      sendSuccess(res, { name: null, since, until, points });
    }
  }),

  /** GET /api/history/names — distinct process names seen within retention. */
  names: asyncHandler(async (_req, res) => {
    const since = Date.now() - metricsService.getRetentionDays() * DAY_MS;
    sendSuccess(res, { names: metricsRepository.distinctNames(since) });
  }),
};
