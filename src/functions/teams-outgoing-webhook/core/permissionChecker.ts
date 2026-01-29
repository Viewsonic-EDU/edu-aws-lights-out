/**
 * Permission checker for Teams Outgoing Webhook.
 *
 * Validates if a user is allowed to execute commands based on an allowlist
 * configured in SSM config.
 */

import type { Config } from '@shared/types';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:teams-outgoing-webhook:permission-checker');

/**
 * Check if user is allowed to execute commands.
 *
 * Permission logic:
 * - If no allowlist is configured (empty or undefined), allow all users
 * - If allowlist is configured, check if user's display name is in the list
 * - Comparison is case-insensitive ("John Doe" = "john doe")
 *
 * @param username - User's Teams display name (from message.from.name)
 * @param config - Config loaded from SSM (contains allowlist)
 * @returns true if user is allowed, false otherwise
 *
 * @example
 * // Allowlist configured: ["John Doe", "Jane Smith"]
 * isUserAllowed("John Doe", config) // true
 * isUserAllowed("john doe", config) // true (case-insensitive)
 * isUserAllowed("Bob Smith", config) // false
 *
 * @example
 * // No allowlist configured (allow all users)
 * isUserAllowed("Anyone", config) // true
 */
export function isUserAllowed(username: string | undefined, config: Config): boolean {
  const allowlist = config.notifications?.teams?.outgoing_webhook?.allowed_users;

  // If Outgoing Webhook is explicitly disabled, deny all users
  const webhookEnabled = config.notifications?.teams?.outgoing_webhook?.enabled ?? true;
  if (!webhookEnabled) {
    logger.warn('Outgoing Webhook is disabled in config');
    return false;
  }

  // If no allowlist configured, allow all users
  if (!allowlist || allowlist.length === 0) {
    logger.debug('No allowlist configured, allowing all users');
    return true;
  }

  // If user has no username, deny
  if (!username) {
    logger.warn('User has no display name, denying access');
    return false;
  }

  // Check if user is in allowlist (case-insensitive)
  const normalizedUsername = username.toLowerCase();
  const isAllowed = allowlist.some(
    (allowedUser) => allowedUser.toLowerCase() === normalizedUsername
  );

  if (isAllowed) {
    logger.info({ username }, 'User authorized');
  } else {
    logger.warn({ username, allowlist }, 'User not in allowlist');
  }

  return isAllowed;
}
