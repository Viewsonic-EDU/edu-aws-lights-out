/**
 * HMAC authentication for Teams Outgoing Webhook.
 *
 * Teams signs requests with HMAC-SHA256 using a security token.
 * This module validates the signature to ensure requests come from Teams.
 *
 * @see https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-outgoing-webhook#security-requirements
 */

import crypto from 'crypto';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:teams-outgoing-webhook:hmac-authenticator');

/**
 * In-memory cache for SSM parameter (security token).
 * Reduces SSM API calls and improves performance.
 */
let cachedSecurityToken: string | null = null;

/**
 * Clear cached security token (for testing purposes).
 * @internal
 */
export function clearCachedSecurityToken(): void {
  cachedSecurityToken = null;
}

/**
 * Retrieve security token from SSM Parameter Store.
 *
 * The security token is stored as a SecureString in SSM:
 * `/lights-out/{stage}/teams-webhook-token`
 *
 * @returns Security token for HMAC validation
 * @throws Error if parameter not found or SSM call fails
 */
export async function getSecurityToken(): Promise<string> {
  // Return cached token if available
  if (cachedSecurityToken) {
    logger.debug('Using cached security token');
    return cachedSecurityToken;
  }

  const stage = process.env.STAGE;
  if (!stage) {
    throw new Error('STAGE environment variable not set');
  }

  const parameterName = `/lights-out/${stage}/teams-webhook-token`;

  logger.info({ parameterName }, 'Loading security token from SSM');

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

    cachedSecurityToken = response.Parameter.Value;
    logger.info('Security token loaded successfully');

    return cachedSecurityToken;
  } catch (error) {
    logger.error({ error: String(error), parameterName }, 'Failed to load security token from SSM');
    throw new Error(
      `Failed to load security token from SSM: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate HMAC signature from Teams Outgoing Webhook.
 *
 * Teams includes a signature in the Authorization header:
 * `Authorization: HMAC <base64-encoded-signature>`
 *
 * Validation steps:
 * 1. Extract signature from Authorization header
 * 2. Compute HMAC-SHA256 of request body using security token
 * 3. Compare computed signature with received signature (timing-safe)
 *
 * @param authHeader - Authorization header value
 * @param requestBody - Raw request body (JSON string)
 * @param securityToken - Security token from SSM
 * @returns true if signature is valid, false otherwise
 */
export function validateHmacSignature(
  authHeader: string | undefined,
  requestBody: string,
  securityToken: string
): boolean {
  if (!authHeader) {
    logger.warn('Missing Authorization header');
    return false;
  }

  // Extract signature from "HMAC <signature>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'HMAC') {
    logger.warn(
      { authHeader },
      'Invalid Authorization header format (expected "HMAC <signature>")'
    );
    return false;
  }

  const receivedSignature = parts[1];

  try {
    // Compute expected signature
    const hmac = crypto.createHmac('sha256', securityToken);
    hmac.update(requestBody, 'utf8');
    const expectedSignature = hmac.digest('base64');

    // Timing-safe comparison to prevent timing attacks
    const receivedBuffer = Buffer.from(receivedSignature, 'base64');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64');

    if (receivedBuffer.length !== expectedBuffer.length) {
      logger.warn('Signature length mismatch');
      return false;
    }

    const isValid = crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

    if (!isValid) {
      logger.warn('HMAC signature mismatch');
    } else {
      logger.debug('HMAC signature validated successfully');
    }

    return isValid;
  } catch (error) {
    logger.error({ error: String(error) }, 'Error during HMAC validation');
    return false;
  }
}
