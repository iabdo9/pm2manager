/**
 * User management API routes (`/api/users`).
 *
 * Every route requires an authenticated administrator.
 */
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.middleware';
import { validateBody, validateParams } from '../middleware/validate.middleware';
import { createUserSchema, userIdParamSchema } from '../validation/schemas';
import { userController } from '../controllers/user.controller';

/** Router mounted at `/api/users`. */
export const userRouter = Router();

userRouter.use(requireAdmin);

userRouter.get('/', userController.list);
userRouter.post('/', validateBody(createUserSchema), userController.create);
userRouter.delete('/:id', validateParams(userIdParamSchema), userController.remove);

export default userRouter;
