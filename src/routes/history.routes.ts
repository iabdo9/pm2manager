/**
 * History routes (`/api/history`).
 *
 * All endpoints require an authenticated session. `/names` is declared before
 * `/` so the literal path is matched ahead of the series endpoint.
 */
import { Router } from 'express';
import { historyController } from '../controllers/history.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateQuery } from '../middleware/validate.middleware';
import { historyQuerySchema } from '../validation/schemas';

/** Router mounted at `/api/history`. */
export const historyRouter = Router();

historyRouter.use(requireAuth);
historyRouter.get('/names', historyController.names);
historyRouter.get('/', validateQuery(historyQuerySchema), historyController.series);

export default historyRouter;
