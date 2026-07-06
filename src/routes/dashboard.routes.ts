/**
 * Dashboard routes (`/api/dashboard`).
 *
 * All endpoints require an authenticated session.
 */
import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/auth.middleware';

/** Router mounted at `/api/dashboard`. */
export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get('/', dashboardController.summary);

export default dashboardRouter;
