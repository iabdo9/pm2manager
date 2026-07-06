/**
 * User management controller (admin-only).
 *
 * Lists application users, creates new accounts (delegating password hashing
 * to the auth service) and deletes accounts — while protecting against
 * self-deletion and removing the final administrator.
 */
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { getClientIp } from '../middleware/auth.middleware';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors';
import { userRepository } from '../repositories/user.repository';
import { sessionRepository } from '../repositories/session.repository';
import { activityService } from '../services/activity.service';
import { authService } from '../services/auth.service';
import type { CreateUserInput } from '../validation/schemas';

export const userController = {
  /**
   * GET /api/users — list all users as public (secret-free) records.
   */
  list: asyncHandler(async (_req, res) => {
    sendSuccess(res, { users: userRepository.listAll().map(authService.toPublicUser) });
  }),

  /**
   * POST /api/users — create a new user account.
   *
   * The body is already validated by `createUserSchema`. Password hashing and
   * uniqueness handling live in the auth service.
   */
  create: asyncHandler(async (req, res) => {
    const input = req.body as CreateUserInput;
    const isAdmin = input.isAdmin ?? false;

    const user = await authService.createUser({
      username: input.username,
      password: input.password,
      isAdmin,
    });

    activityService.record({
      type: 'user_created',
      message: `Created user "${user.username}"`,
      username: req.session.user?.username ?? null,
      ipAddress: getClientIp(req),
      metadata: { createdUser: user.username, isAdmin },
    });

    sendSuccess(res, authService.toPublicUser(user), 201);
  }),

  /**
   * DELETE /api/users/:id — delete a user account.
   *
   * Refuses to delete the caller's own account (400) or the last remaining
   * administrator (409); returns 404 when the target does not exist.
   */
  remove: asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: number };
    const currentUser = req.session.user;

    if (currentUser && id === currentUser.id) {
      throw new BadRequestError('You cannot delete your own account');
    }

    const target = userRepository.findById(id);
    if (!target) {
      throw new NotFoundError('User not found');
    }

    if (target.is_admin === 1) {
      const adminCount = userRepository.listAll().filter((u) => u.is_admin === 1).length;
      if (adminCount === 1) {
        throw new ConflictError('Cannot delete the last administrator');
      }
    }

    userRepository.delete(id);
    // Immediately revoke the deleted user's active sessions so access ends now,
    // not whenever their session would have idled out.
    const revoked = sessionRepository.deleteByUserId(id);

    activityService.record({
      type: 'user_deleted',
      message: `Deleted user "${target.username}"`,
      username: currentUser?.username ?? null,
      ipAddress: getClientIp(req),
      metadata: { deletedUser: target.username, sessionsRevoked: revoked },
    });

    sendSuccess(res, {});
  }),
};
