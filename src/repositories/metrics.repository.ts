/**
 * Data access for the `metrics` table (historical process metrics).
 */
import { getDb } from '../db';
import type { MetricInput, MetricPoint, MetricRecord } from '../types';

export interface MetricsQuery {
  /** Process name to filter by. */
  name?: string;
  /** Inclusive lower bound (epoch ms). */
  since?: number;
  /** Inclusive upper bound (epoch ms). */
  until?: number;
  limit?: number;
}

/**
 * Approximate number of points a chart should receive. Series are downsampled
 * (time-bucketed + averaged) to this many points across the requested window,
 * so a wide range (e.g. 7 days) covers the *whole* window instead of silently
 * truncating to the oldest N raw samples.
 */
const TARGET_POINTS = 500;

/**
 * Choose a bucket size (ms) that spreads `TARGET_POINTS` buckets across the
 * `[since, until]` window. Never smaller than 1ms.
 */
function bucketMsFor(since: number, until: number): number {
  const span = Math.max(0, until - since);
  return Math.max(1, Math.ceil(span / TARGET_POINTS));
}

export const metricsRepository = {
  /** Insert many samples in a single transaction. */
  insertMany(samples: MetricInput[]): void {
    if (samples.length === 0) return;
    const stmt = getDb().prepare(
      `INSERT INTO metrics (pm_id, name, status, cpu, memory, uptime, restart_count, timestamp)
       VALUES (@pmId, @name, @status, @cpu, @memory, @uptime, @restartCount, @timestamp)`,
    );
    const insert = getDb().transaction((rows: MetricInput[]) => {
      for (const row of rows) stmt.run(row);
    });
    insert(samples);
  },

  /**
   * Downsampled time-series for a single process across the whole `[since,
   * until]` window (oldest → newest). Samples are bucketed by time and
   * averaged so the full range is represented in ~`TARGET_POINTS` points.
   */
  seriesForProcess(name: string, since: number, until?: number): MetricPoint[] {
    const upper = until ?? Date.now();
    const bucket = bucketMsFor(since, upper);
    const rows = getDb()
      .prepare(
        `SELECT CAST(timestamp / ? AS INTEGER) * ? AS timestamp,
                AVG(cpu) AS cpu,
                AVG(memory) AS memory,
                MAX(restart_count) AS restartCount,
                '' AS status
         FROM metrics
         WHERE name = ? AND timestamp >= ? AND timestamp <= ?
         GROUP BY CAST(timestamp / ? AS INTEGER)
         ORDER BY timestamp ASC`,
      )
      .all(bucket, bucket, name, since, upper, bucket) as MetricPoint[];
    return rows;
  },

  /**
   * Downsampled overall series (summed across all processes per sample, then
   * time-bucketed and averaged) for the dashboard CPU/memory charts. Covers the
   * whole `[since, until]` window in ~`TARGET_POINTS` points, oldest → newest.
   */
  aggregateSeries(since: number, until?: number): Array<{
    timestamp: number;
    cpu: number;
    memory: number;
  }> {
    const upper = until ?? Date.now();
    const bucket = bucketMsFor(since, upper);
    return getDb()
      .prepare(
        `SELECT CAST(t.timestamp / ? AS INTEGER) * ? AS timestamp,
                AVG(t.cpu) AS cpu,
                AVG(t.memory) AS memory
         FROM (
           SELECT timestamp, SUM(cpu) AS cpu, SUM(memory) AS memory
           FROM metrics
           WHERE timestamp >= ? AND timestamp <= ?
           GROUP BY timestamp
         ) t
         GROUP BY CAST(t.timestamp / ? AS INTEGER)
         ORDER BY timestamp ASC`,
      )
      .all(bucket, bucket, since, upper, bucket) as Array<{
      timestamp: number;
      cpu: number;
      memory: number;
    }>;
  },

  /** Distinct process names seen within the retention window. */
  distinctNames(since: number): string[] {
    const rows = getDb()
      .prepare('SELECT DISTINCT name FROM metrics WHERE timestamp >= ? ORDER BY name')
      .all(since) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  },

  latestForAll(): MetricRecord[] {
    return getDb()
      .prepare(
        `SELECT m.* FROM metrics m
         JOIN (SELECT name, MAX(timestamp) AS ts FROM metrics GROUP BY name) latest
           ON m.name = latest.name AND m.timestamp = latest.ts`,
      )
      .all() as MetricRecord[];
  },

  /** Delete samples older than the given epoch-ms cutoff. Returns rows removed. */
  deleteOlderThan(cutoffMs: number): number {
    const result = getDb().prepare('DELETE FROM metrics WHERE timestamp < ?').run(cutoffMs);
    return result.changes;
  },
};
