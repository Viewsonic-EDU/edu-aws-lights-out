/**
 * Command parser for Teams Outgoing Webhook messages.
 *
 * Parses bot mentions and extracts action.
 * Environment/resource configuration is determined by SSM config path (one webhook = one environment).
 *
 * Supported formats:
 * - "@LightsOut start" → { action: 'start' }
 * - "@LightsOut stop" → { action: 'stop' }
 * - "@LightsOut status" → { action: 'status' }
 * - "@LightsOut discover" → { action: 'discover' }
 * - "@LightsOut help" → { valid: false, error: 'help message' }
 */

import type { LambdaAction } from '@shared/types';
import type { CommandParseResult } from '../types';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:teams-outgoing-webhook:command-parser');

const VALID_ACTIONS: ReadonlySet<string> = new Set(['start', 'stop', 'status', 'discover', 'help']);

/**
 * Parse command from Teams Outgoing Webhook message text.
 *
 * @param text - Message text from Teams (includes bot mention)
 * @returns Parse result with action
 *
 * @example
 * parseCommand("<at>LightsOut</at> start")
 * // Returns: { valid: true, action: 'start' }
 *
 * @example
 * parseCommand("@LightsOut help")
 * // Returns: { valid: false, error: 'help message...' }
 */
export function parseCommand(text: string): CommandParseResult {
  if (!text || text.trim() === '') {
    logger.warn('Empty command text');
    return {
      valid: false,
      error: '❌ Empty command',
    };
  }

  // Remove bot mentions
  // Teams formats mentions as: <at>BotName</at> command
  // Also handle plain @mentions: @BotName command
  const cleanText = text
    .replace(/<at>.*?<\/at>/gi, '') // Remove XML-style mention
    .replace(/@\w+/g, '') // Remove @mentions
    .trim();

  logger.debug({ originalText: text, cleanText }, 'Cleaned command text');

  // Split into parts
  const parts = cleanText.split(/\s+/).filter((p) => p.length > 0);

  if (parts.length === 0) {
    logger.warn('No command specified after removing mentions');
    return {
      valid: false,
      error: '❌ No command specified. Type `@LightsOut help` for usage.',
    };
  }

  const action = parts[0].toLowerCase();

  // Special case: help command
  if (action === 'help') {
    logger.info('Help command requested');
    return {
      valid: false,
      error: getHelpMessage(),
    };
  }

  // Validate action
  if (!VALID_ACTIONS.has(action) || action === 'help') {
    logger.warn({ action }, 'Unknown action');
    return {
      valid: false,
      error: `❌ Unknown action **${action}**. Type \`@LightsOut help\` for usage.`,
    };
  }

  logger.info({ action }, 'Command parsed successfully');

  return {
    valid: true,
    action: action as LambdaAction,
  };
}

/**
 * Get help message with available commands.
 *
 * @returns Markdown-formatted help message
 */
function getHelpMessage(): string {
  return (
    '**LightsOut Bot - Available Commands**\n\n' +
    '• `@LightsOut start` - Start all managed resources\n' +
    '• `@LightsOut stop` - Stop all managed resources\n' +
    '• `@LightsOut status` - Check status of all resources\n' +
    '• `@LightsOut discover` - List all managed resources\n' +
    '• `@LightsOut help` - Show this help message\n\n' +
    '**Note:** This bot manages resources defined in SSM config.\n' +
    'Each webhook controls a specific environment.'
  );
}
