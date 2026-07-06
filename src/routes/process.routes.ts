/**
 * Process routes — wires the `/api/processes` REST + SSE endpoints.
 *
 * Every route requires an authenticated session. Route parameters are
 * validated with zod before reaching the controllers. Ordering is deliberate:
 * the static `/actions/:action` collection route is declared before the
 * `/:idOrName` wildcard, and the `/logs/stream` SSE route before the generic
 * `/:idOrName/:action` action route, so the more specific paths win.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { validateParams } from '../middleware/validate.middleware';
import {
  bulkActionParamSchema,
  logStreamParamSchema,
  processActionParamSchema,
  processIdParamSchema,
} from '../validation/schemas';
import { processController } from '../controllers/process.controller';
import { logsController } from '../controllers/logs.controller';

/** Router mounted at `/api/processes`; all routes require authentication. */
export const processRouter = Router();

processRouter.use(requireAuth);

processRouter.get('/', processController.list);

processRouter.post(
  '/actions/:action',
  validateParams(bulkActionParamSchema),
  processController.bulkAction,
);

processRouter.get('/:idOrName', validateParams(processIdParamSchema), processController.detail);

processRouter.get(
  '/:idOrName/logs/stream',
  validateParams(logStreamParamSchema),
  logsController.stream,
);

processRouter.post(
  '/:idOrName/:action',
  validateParams(processActionParamSchema),
  processController.action,
);

processRouter.delete('/:idOrName', validateParams(processIdParamSchema), processController.remove);

export default processRouter;
