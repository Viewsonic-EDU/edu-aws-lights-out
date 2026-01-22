/**
 * Type definitions for Teams Outgoing Webhook handler.
 */

/**
 * Teams Outgoing Webhook message structure.
 * Represents the payload sent by Teams when a user @mentions the bot.
 *
 * @see https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-outgoing-webhook
 */
export interface OutgoingWebhookMessage {
  /**
   * Message type (always 'message' for Outgoing Webhooks).
   */
  type: 'message';

  /**
   * Unique message ID.
   */
  id: string;

  /**
   * ISO timestamp of when the message was sent.
   */
  timestamp: string;

  /**
   * Message text content, including bot mention.
   * Example: "<at>LightsOut</at> start airsync-dev"
   */
  text: string;

  /**
   * Information about the user who sent the message.
   */
  from: {
    /**
     * User's unique ID.
     */
    id: string;

    /**
     * User's display name (e.g., "John Doe").
     * Used for allowlist permission checking.
     */
    name: string;
  };

  /**
   * Optional Teams channel data.
   */
  channelData?: {
    /**
     * Teams channel ID where the message was sent.
     */
    teamsChannelId?: string;

    /**
     * Teams team ID.
     */
    teamsTeamId?: string;

    [key: string]: unknown;
  };

  [key: string]: unknown;
}

/**
 * Command parse result from commandParser.
 */
export interface CommandParseResult {
  /**
   * Whether the command is valid.
   */
  valid: boolean;

  /**
   * Parsed action (if valid).
   */
  action?: 'start' | 'stop' | 'status' | 'discover';

  /**
   * Error message (if invalid).
   */
  error?: string;
}

/**
 * Outgoing Webhook response message.
 * This is sent back to Teams as the bot's reply.
 */
export interface OutgoingWebhookResponse {
  /**
   * Response type (always 'message').
   */
  type: 'message';

  /**
   * Response text (supports markdown).
   */
  text: string;
}
