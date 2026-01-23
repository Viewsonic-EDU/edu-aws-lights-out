/**
 * AWS Lambda handler for Power Automate webhook integration.
 *
 * This handler provides an alternative to Teams Outgoing Webhook (which has a platform bug)
 * by accepting webhook requests from Microsoft Power Automate flows.
 *
 * Security Model:
 * - API Key authentication (Bearer token in Authorization header)
 * - User whitelist validation (allowed_users from SSM config)
 * - Command parsing and validation
 *
 * @see docs/power-automate-setup.md for setup instructions
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import type { TriggerSource } from '@shared/types';
import type { PowerAutomateRequest, PowerAutomateResponse } from './types';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { parseCommand } from '@functions/teams-outgoing-webhook/core/commandParser';
import { invokeMainHandler } from '@functions/teams-outgoing-webhook/core/handlerInvoker';
import { isUserAllowed } from '@functions/teams-outgoing-webhook/core/permissionChecker';
import { loadConfigFromSsm } from '@functions/handler/core/config';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:power-automate-webhook');

/**
 * In-memory cache for API key (reduces SSM calls).
 */
let cachedApiKey: string | null = null;

/**
 * Clear cached API key (for testing purposes).
 * @internal
 */
export function clearCachedApiKey(): void {
  cachedApiKey = null;
}

/**
 * Retrieve API key from SSM Parameter Store.
 *
 * The API key is stored as a SecureString in SSM:
 * `/lights-out/{stage}/power-automate-api-key`
 *
 * @returns API key for authentication
 * @throws Error if parameter not found or SSM call fails
 */
async function getApiKey(): Promise<string> {
  // Return cached key if available
  if (cachedApiKey) {
    logger.debug('Using cached API key');
    return cachedApiKey;
  }

  const stage = process.env.STAGE;
  if (!stage) {
    throw new Error('STAGE environment variable not set');
  }

  const parameterName = `/lights-out/${stage}/power-automate-api-key`;

  logger.info({ parameterName }, 'Loading API key from SSM');

  const ssmClient = new SSMClient({});

  try {
    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true, // Decrypt SecureString
    });

    const response = await ssmClient.send(command);

    if (!response.Parameter?.Value) {
      throw new Error(`SSM parameter ${parameterName} has no value`);
    }

    cachedApiKey = response.Parameter.Value;
    logger.info('API key loaded successfully');

    return cachedApiKey;
  } catch (error) {
    logger.error({ error: String(error), parameterName }, 'Failed to load API key from SSM');
    throw new Error(
      `Failed to load API key from SSM: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate API key from Authorization header.
 *
 * Expected format: "Authorization: Bearer <api-key>"
 *
 * @param authHeader - Authorization header value
 * @param expectedKey - Expected API key from SSM
 * @returns true if key is valid, false otherwise
 */
function validateApiKey(authHeader: string | undefined, expectedKey: string): boolean {
  if (!authHeader) {
    logger.warn('Missing Authorization header');
    return false;
  }

  // Extract key from "Bearer <key>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    logger.warn({ authHeader }, 'Invalid Authorization header format (expected "Bearer <key>")');
    return false;
  }

  const receivedKey = parts[1];

  // Constant-time comparison to prevent timing attacks
  if (receivedKey.length !== expectedKey.length) {
    logger.warn('API key length mismatch');
    return false;
  }

  // Simple constant-time comparison (for API keys without crypto.timingSafeEqual requirement)
  let isValid = true;
  for (let i = 0; i < expectedKey.length; i++) {
    if (receivedKey[i] !== expectedKey[i]) {
      isValid = false;
    }
  }

  if (!isValid) {
    logger.warn('API key mismatch');
  } else {
    logger.debug('API key validated successfully');
  }

  return isValid;
}

/**
 * Build a success response for Power Automate.
 *
 * @param message - Message text (supports markdown)
 * @returns API Gateway response
 */
function buildSuccessResponse(message: string): APIGatewayProxyResult {
  const response: PowerAutomateResponse = {
    success: true,
    message,
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(response),
  };
}

/**
 * Build an error response for Power Automate.
 *
 * @param message - Error message
 * @param errorCode - Optional error code for debugging
 * @param statusCode - HTTP status code
 * @returns API Gateway response
 */
function buildErrorResponse(
  message: string,
  errorCode?: string,
  statusCode: number = 400
): APIGatewayProxyResult {
  const response: PowerAutomateResponse = {
    success: false,
    message,
    errorCode,
  };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(response),
  };
}

/**
 * Lambda handler for Power Automate webhook.
 *
 * Validates API key and processes Teams bot commands via Power Automate.
 *
 * @param event - API Gateway proxy event
 * @param context - Lambda context
 * @returns API Gateway proxy result
 */
export async function main(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const requestId = context.awsRequestId;

  logger.info({ requestId }, 'Power Automate webhook request received');

  try {
    // 1. Validate API key
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const apiKey = await getApiKey();
    const isValidKey = validateApiKey(authHeader, apiKey);

    if (!isValidKey) {
      logger.warn({ requestId }, 'Invalid API key');
      return buildErrorResponse('❌ Unauthorized: Invalid API key', 'INVALID_API_KEY', 401);
    }

    logger.info({ requestId }, 'API key validated successfully');

    // 2. Parse request body
    if (!event.body) {
      logger.warn({ requestId }, 'Empty request body');
      return buildErrorResponse('❌ Empty request body', 'EMPTY_BODY');
    }

    const request = JSON.parse(event.body) as PowerAutomateRequest;

    // 3. Validate required fields
    if (!request.user) {
      logger.warn({ requestId }, 'Missing user field');
      return buildErrorResponse('❌ Missing required field: user', 'MISSING_USER');
    }

    if (!request.command) {
      logger.warn({ requestId }, 'Missing command field');
      return buildErrorResponse('❌ Missing required field: command', 'MISSING_COMMAND');
    }

    logger.info(
      {
        requestId,
        user: request.user,
        command: request.command,
        messageId: request.messageId,
      },
      'Request parsed successfully'
    );

    // 4. Parse command (supports both "/lights-out start" and "lights-out start")
    const commandText = request.command.startsWith('/')
      ? request.command.substring(1) // Remove leading "/"
      : request.command;

    const commandResult = parseCommand(commandText);

    if (!commandResult.valid || !commandResult.action) {
      logger.warn({ command: request.command, error: commandResult.error }, 'Invalid command');
      return buildSuccessResponse(
        commandResult.error ||
          '❌ Invalid command\n\nUsage: `/lights-out <command>`\nCommands: start, stop, status, discover'
      );
    }

    const action = commandResult.action;

    // 5. Load config from SSM and check user permission
    const configParameter = process.env.CONFIG_PARAMETER_NAME || '/lights-out/config';
    logger.debug({ configParameter }, 'Loading config from SSM');

    const config = await loadConfigFromSsm(configParameter);

    const isAllowed = isUserAllowed(request.user, config);

    if (!isAllowed) {
      logger.warn(
        {
          user: request.user,
          requestId,
        },
        'User not authorized to execute commands'
      );

      return buildSuccessResponse(
        '❌ **Unauthorized**: You are not allowed to execute commands.\n\n' +
          'Please contact your administrator if you need access.'
      );
    }

    logger.info({ user: request.user }, 'User authorized successfully');

    // 6. Build trigger source metadata
    const triggerSource: TriggerSource = {
      type: 'teams-bot',
      identity: request.user, // Use display name as identity (no user ID available from Power Automate)
      displayName: `@${request.user}`,
      metadata: {
        powerAutomate: true,
        teamsMessageId: request.messageId,
        teamsChannelId: request.channelId,
        teamsTeamId: request.teamId,
      },
    };

    // 7. Invoke main handler Lambda (fire-and-forget)
    logger.info(
      {
        action,
        user: request.user,
        requestId,
      },
      'Invoking main handler Lambda'
    );

    const invocationResult = await invokeMainHandler({
      action,
      triggerSource,
    });

    if (!invocationResult.success) {
      logger.error({ error: invocationResult.error, requestId }, 'Failed to invoke main handler');
      return buildErrorResponse(
        `❌ Failed to invoke handler: ${invocationResult.error}`,
        'INVOCATION_FAILED',
        500
      );
    }

    // 8. Send immediate acknowledgment to Power Automate (which will post to Teams)
    const acknowledgment =
      `✅ Command received: **${action.toUpperCase()}**\n\n` +
      `ℹ️ Processing resources... Check this channel for detailed status in ~30 seconds.`;

    logger.info({ requestId }, 'Command processed successfully');

    return buildSuccessResponse(acknowledgment);
  } catch (error) {
    logger.error({ error: String(error), requestId }, 'Handler execution failed');
    return buildErrorResponse(
      `❌ Internal error: ${error instanceof Error ? error.message : String(error)}`,
      'INTERNAL_ERROR',
      500
    );
  }
}
