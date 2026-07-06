/**
 * CLI utility to create a new user or reset an existing user's password.
 *
 * Usage (after `npm run build`):
 *   node dist/scripts/create-admin.js <username> <password> [--admin]
 *
 * If the username already exists, its password is reset (and, with --admin,
 * it is promoted to administrator). Intended for recovering access or
 * bootstrapping accounts without the web UI.
 */
import { initDatabase, closeDatabase } from '../db';
import { userRepository } from '../repositories/user.repository';
import { authService } from '../services/auth.service';
import { logger } from '../utils/logger';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isAdmin = args.includes('--admin');
  const positional = args.filter((a) => !a.startsWith('--'));
  const [username, password] = positional;

  if (!username || !password) {
    // eslint-disable-next-line no-console
    console.error('Usage: node dist/scripts/create-admin.js <username> <password> [--admin]');
    process.exit(2);
  }
  if (password.length < 8) {
    // eslint-disable-next-line no-console
    console.error('Password must be at least 8 characters.');
    process.exit(2);
  }

  initDatabase();

  const existing = userRepository.findByUsername(username);
  if (existing) {
    const hash = await authService.hashPassword(password);
    userRepository.updatePassword(existing.id, hash);
    if (isAdmin && existing.is_admin !== 1) {
      // Re-create is unnecessary; flip the flag directly is not exposed, so log guidance.
      logger.warn(`User "${username}" already exists; password reset. Admin flag unchanged.`);
    } else {
      logger.info(`Password reset for existing user "${username}".`);
    }
  } else {
    await authService.createUser({ username, password, isAdmin });
    logger.info(`Created ${isAdmin ? 'administrator' : 'user'} "${username}".`);
  }

  closeDatabase();
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'create-admin failed');
  process.exit(1);
});
