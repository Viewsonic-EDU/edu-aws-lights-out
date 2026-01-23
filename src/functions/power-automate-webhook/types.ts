/**
 * Type definitions for Power Automate webhook handler.
 *
 * This handler processes webhook requests from Microsoft Teams via Power Automate
 * as an alternative to the Teams Outgoing Webhook (which has a platform bug).
 */

/**
 * Power Automate webhook request payload.
 *
 * Sent by Power Automate flow when a Teams message matches the trigger condition.
 */
export interface PowerAutomateRequest {
  /**
   * Teams user display name (from @{triggerBody()?['from']?['displayName']}).
   * Used for permission checking against allowed_users whitelist.
   */
  user: string;

  /**
   * Full command text (e.g., "/lights-out start").
   */
  command: string;

  /**
   * Teams message ID (optional).
   */
  messageId?: string;

  /**
   * Teams channel ID (optional).
   */
  channelId?: string;

  /**
   * Teams team ID (optional).
   */
  teamId?: string;
}

/**
 * Power Automate webhook response.
 *
 * Returned to Power Automate flow, which can then post the message back to Teams.
 */
export interface PowerAutomateResponse {
  /**
   * Whether the command was successfully processed.
   */
  success: boolean;

  /**
   * Message to display in Teams (supports markdown).
   */
  message: string;

  /**
   * Optional error code for debugging.
   */
  errorCode?: string;
}
