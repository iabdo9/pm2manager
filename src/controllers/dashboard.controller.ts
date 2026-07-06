/**
 * Dashboard controller.
 *
 * Exposes the single read-only dashboard summary endpoint. All aggregation
 * work lives in `dashboardService`; the controller only adapts it to the HTTP
 * response envelope.
 */
import { dashboardService } from '../services/dashboard.service';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';

export const dashboardController = {
  /** GET /api/dashboard — return the aggregated dashboard summary. */
  summary: asyncHandler(async (_req, res) => {
    sendSuccess(res, await dashboardService.getSummary());
  }),
};
