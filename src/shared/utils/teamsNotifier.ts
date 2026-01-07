/**
 * Teams Notification Utility
 *
 * Sends Microsoft Teams notifications for lights-out action results.
 * This utility is called directly from resource handlers after start/stop operations.
 */

import fetch from 'node-fetch';
import type { HandlerResult, TeamsNotificationConfig, TriggerSource } from '@shared/types';
import { setupLogger } from './logger';

const logger = setupLogger('lights-out:teams-notifier');

/**
 * Send Teams notification for a handler action result.
 *
 * @param config - Teams notification configuration from SSM
 * @param result - Handler action result (start/stop/status)
 * @param environment - Environment name (e.g., "workshop", "dev", "production")
 */
export async function sendTeamsNotification(
  config: TeamsNotificationConfig,
  result: HandlerResult,
  environment: string
): Promise<void> {
  // Check if notifications are enabled
  if (!config.enabled) {
    logger.debug('Teams notifications disabled, skipping');
    return;
  }

  // Create adaptive card
  const card = createActionResultCard(result, environment);

  logger.debug(
    {
      action: result.action,
      resourceType: result.resourceType,
      resourceId: result.resourceId,
      success: result.success,
      webhookUrl: config.webhook_url.substring(0, 50) + '...', // Log partial URL for security
    },
    'Sending Teams notification'
  );

  try {
    const response = await fetch(config.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        },
        'Teams webhook request failed'
      );
      return;
    }

    logger.info(
      {
        action: result.action,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        success: result.success,
      },
      'Teams notification sent successfully'
    );
  } catch (error) {
    logger.error(
      {
        error: String(error),
        action: result.action,
        resourceType: result.resourceType,
      },
      'Failed to send Teams notification'
    );
    // Don't throw - notification failure should not affect the main operation
  }
}

/**
 * Create Microsoft Teams Adaptive Card for action result.
 *
 * @param result - Handler action result
 * @param environment - Environment name
 * @returns Adaptive Card in Teams message format
 */
function createActionResultCard(result: HandlerResult, environment: string): object {
  // Format timestamp in Asia/Taipei timezone (e.g., "2025-01-07 14:30:45 GMT+8")
  const timestamp = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const actionUpper = result.action.toUpperCase();
  const statusColor = result.success ? 'good' : 'attention';
  const statusEmoji = result.success ? '✅' : '❌';
  const statusText = result.success ? 'Success' : 'Failed';

  // Format trigger source display
  const triggerSourceDisplay = formatTriggerSourceDisplay(result.triggerSource);

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: `${statusEmoji} Lights-Out ${actionUpper} - ${statusText}`,
              weight: 'bolder',
              size: 'large',
              color: statusColor,
            },
            {
              type: 'FactSet',
              facts: [
                {
                  title: 'Environment',
                  value: environment,
                },
                {
                  title: 'Action',
                  value: actionUpper,
                },
                {
                  title: 'Triggered By',
                  value: triggerSourceDisplay,
                },
                {
                  title: 'Resource Type',
                  value: result.resourceType.toUpperCase().replace('-', ' '),
                },
                {
                  title: 'Resource ID',
                  value: result.resourceId,
                },
                {
                  title: 'Status',
                  value: statusText,
                },
                {
                  title: 'Message',
                  value: result.message,
                },
                ...(result.error
                  ? [
                      {
                        title: 'Error',
                        value: result.error,
                      },
                    ]
                  : []),
                {
                  title: 'Timestamp',
                  value: timestamp,
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/**
 * Format trigger source for Teams display.
 *
 * @param triggerSource - Trigger source metadata
 * @returns Formatted display string
 */
function formatTriggerSourceDisplay(triggerSource?: TriggerSource): string {
  if (!triggerSource) {
    return '🔹 Unknown';
  }

  switch (triggerSource.type) {
    case 'eventbridge-scheduled':
      return `⏰ EventBridge: ${triggerSource.displayName}`;
    case 'manual-invoke':
      return `👤 Manual: ${triggerSource.displayName}`;
    case 'teams-bot':
      return `💬 Teams Bot: ${triggerSource.displayName}`;
    case 'unknown':
    default:
      return '🔹 Unknown';
  }
}
