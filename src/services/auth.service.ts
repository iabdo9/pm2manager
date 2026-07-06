/**
 * Authentication service.
 *
 * Encapsulates all password/credential business logic: Argon2id password
 * hashing and verification, credential checking (with user-enumeration timing
 * hardening), mapping of stored user rows to their client-safe shape, password
 * changes, user creation, and bootstrapping the initial administrator account.
 * Repositories provide the raw SQL; this service owns the security rules.
 */
import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { config } from '../config';
import { userRepository } from '../repositories/user.repository';
import type { PublicUser, UserRecord } from '../types';
import { ConflictError, NotFoundError, UnauthorizedError } from '../utils/errors';

/**
 * A valid Argon2id hash of a throwaway value. Used to spend comparable CPU time
 * verifying a password even when the username does not exist, so that response
 * timing does not reveal whether an account is present (user enumeration).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$KGBmtKWCfA417Kb+DpUuTw$xU8mocjwJyFrt5dYDvTlrmAWfxbeHFfAmZHmFrU0/Ik';

export const authService = {
  /**
   * Hash a plaintext password using Argon2id (the library default algorithm).
   */
  async hashPassword(plain: string): Promise<string> {
    return hash(plain);
  },

  /**
   * Verify a plaintext password against a stored Argon2 hash. Returns `false`
   * (never throws) when the hash is malformed or verification fails.
   */
  async verifyPassword(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  },

  /**
   * Look up a user by username and validate the supplied password. Returns the
   * matching {@link UserRecord} on success, or `null` when the username is
   * unknown or the password is wrong. When the username is unknown a dummy
   * verification is still performed to keep the timing profile constant.
   */
  async verifyCredentials(username: string, password: string): Promise<UserRecord | null> {
    const user = userRepository.findByUsername(username);
    if (!user) {
      await this.verifyPassword(DUMMY_HASH, password);
      return null;
    }
    const ok = await this.verifyPassword(user.password_hash, password);
    return ok ? user : null;
  },

  /**
   * Map a stored user row to the client-safe {@link PublicUser}, converting the
   * SQLite integer flags (`0` | `1`) into booleans and stripping all secrets.
   */
  toPublicUser(u: UserRecord): PublicUser {
    return {
      id: u.id,
      username: u.username,
      totpEnabled: u.totp_enabled === 1,
      isAdmin: u.is_admin === 1,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    };
  },

  /**
   * Change a user's password after verifying their current one.
   * @throws NotFoundError when the user does not exist.
   * @throws UnauthorizedError when the current password is incorrect.
   */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    const ok = await this.verifyPassword(user.password_hash, currentPassword);
    if (!ok) {
      throw new UnauthorizedError('Current password is incorrect');
    }
    const newHash = await this.hashPassword(newPassword);
    userRepository.updatePassword(user.id, newHash);
  },

  /**
   * Create a new user with a hashed password.
   * @throws ConflictError when the username is already taken.
   */
  async createUser(input: {
    username: string;
    password: string;
    isAdmin: boolean;
  }): Promise<UserRecord> {
    if (userRepository.findByUsername(input.username)) {
      throw new ConflictError('Username already exists');
    }
    const passwordHash = await this.hashPassword(input.password);
    return userRepository.create({
      username: input.username,
      passwordHash,
      isAdmin: input.isAdmin,
    });
  },

  /**
   * Ensure at least one administrator exists. When the users table is empty a
   * bootstrap admin is created from configuration; if no admin password was
   * configured a strong random one is generated and returned so it can be
   * surfaced (e.g. logged once) to the operator.
   *
   * @returns Whether an admin was created, the admin username, and the
   *   generated password (only when one had to be generated, otherwise `null`).
   */
  async ensureInitialAdmin(): Promise<{
    created: boolean;
    username: string;
    generatedPassword: string | null;
  }> {
    const username = config.admin.username;
    if (userRepository.countAll() > 0) {
      return { created: false, username, generatedPassword: null };
    }
    const generatedPassword = config.admin.password
      ? null
      : crypto.randomBytes(12).toString('base64url');
    const password = config.admin.password ?? (generatedPassword as string);
    await this.createUser({ username, password, isAdmin: true });
    return { created: true, username, generatedPassword };
  },
};
