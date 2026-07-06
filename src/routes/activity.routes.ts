/**
 * Activity routes (`/api/activity`).
 *
 * All endpoints require an authenticated session.
 */
import { Router } from 'express';
import { activityController } from '../controllers/activity.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateQuery } from '../middleware/validate.middleware';
import { activityQuerySchema } from '../validation/schemas';

/** Router mounted at `/api/activity`. */
export const activityRouter = Router();

activityRouter.use(requireAuth);
activityRouter.get('/', validateQuery(activityQuerySchema), activityController.list);

export default activityRouter;
