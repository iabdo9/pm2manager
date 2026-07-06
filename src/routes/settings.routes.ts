/**
 * Settings API routes (`/api/settings`).
 *
 * All routes require authentication; mutation additionally requires an
 * administrator.
 */
import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { updateSettingsSchema } from '../validation/schemas';
import { settingsController } from '../controllers/settings.controller';

/** Router mounted at `/api/settings`. */
export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get('/', settingsController.getSettings);
settingsRouter.put(
  '/',
  requireAdmin,
  validateBody(updateSettingsSchema),
  settingsController.updateSettings,
);

export default settingsRouter;
