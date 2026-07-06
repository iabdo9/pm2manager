/**
 * Activity controller — paginated access to the audit/activity log.
 *
 * Reads the pre-validated query (`activityQuerySchema`) and returns a page of
 * activity records alongside the total count for the (optionally filtered) set.
 */
import { activityService } from '../services/activity.service';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import type { ActivityQuery } from '../validation/schemas';

export const activityController = {
  /**
   * GET /api/activity — return a page of activity records plus the total.
   * Query is pre-validated by `activityQuerySchema`.
   */
  list: asyncHandler(async (req, res) => {
    const { limit, offset, type } = req.query as unknown as ActivityQuery;
    const items = activityService.list({ limit, offset, type });
    const total = activityService.count(type);
    sendSuccess(res, { items, total, limit, offset });
  }),
};
