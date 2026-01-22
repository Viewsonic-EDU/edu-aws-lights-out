/**
 * Main handler Lambda invoker.
 *
 * Invokes the main handler Lambda function asynchronously (fire-and-forget).
 * The main handler will send results via Teams notification.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { LambdaAction, TriggerSource } from '@shared/types';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:teams-outgoing-webhook:handler-invoker');

/**
 * Payload for main handler Lambda invocation.
 */
export interface HandlerInvocationPayload {
  /**
   * Action to perform (start, stop, status, discover).
   */
  action: LambdaAction;

  /**
   * Trigger source metadata (who triggered this action).
   */
  triggerSource: TriggerSource;
}

/**
 * Result of Lambda invocation.
 */
export interface InvocationResult {
  /**
   * Whether invocation was successful.
   */
  success: boolean;

  /**
   * Error message if invocation failed.
   */
  error?: string;
}

/**
 * Invoke main handler Lambda function asynchronously.
 *
 * Uses InvocationType: 'Event' for fire-and-forget invocation.
 * The Lambda will return immediately without waiting for the handler to complete.
 *
 * @param payload - Invocation payload
 * @returns Invocation result (success/failure)
 */
export async function invokeMainHandler(
  payload: HandlerInvocationPayload
): Promise<InvocationResult> {
  const functionName = process.env.MAIN_HANDLER_FUNCTION_NAME;

  if (!functionName) {
    const error = 'MAIN_HANDLER_FUNCTION_NAME environment variable not set';
    logger.error(error);
    throw new Error(error);
  }

  const lambdaClient = new LambdaClient({});

  try {
    logger.info(
      {
        functionName,
        action: payload.action,
        triggerSource: payload.triggerSource.type,
      },
      'Invoking main handler Lambda'
    );

    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event', // Asynchronous invocation (fire-and-forget)
      Payload: JSON.stringify(payload),
    });

    await lambdaClient.send(command);

    logger.info('Main handler Lambda invoked successfully');
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg, functionName }, 'Failed to invoke main handler Lambda');
    return { success: false, error: errorMsg };
  }
}
