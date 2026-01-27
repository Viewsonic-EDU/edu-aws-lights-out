import { describe, it, expect } from 'vitest';
import { isUserAllowed } from '@functions/teams-outgoing-webhook/core/permissionChecker';
import type { Config } from '@shared/types';

describe('permissionChecker', () => {
  const createConfig = (allowedUsers?: string[], enabled: boolean = true): Config => ({
    version: '1.0',
    environment: 'test',
    discovery: {
      method: 'tags',
      tags: { 'lights-out:managed': 'true' },
    },
    notifications: {
      teams: {
        enabled: true,
        webhook_url: 'https://example.com/webhook',
        outgoing_webhook: {
          enabled,
          allowed_users: allowedUsers,
        },
      },
    },
  });

  describe('With allowlist configured', () => {
    it('should allow user in allowlist', () => {
      const config = createConfig(['John Doe', 'Jane Smith']);
      const result = isUserAllowed('John Doe', config);

      expect(result).toBe(true);
    });

    it('should allow second user in allowlist', () => {
      const config = createConfig(['John Doe', 'Jane Smith']);
      const result = isUserAllowed('Jane Smith', config);

      expect(result).toBe(true);
    });

    it('should deny user not in allowlist', () => {
      const config = createConfig(['John Doe', 'Jane Smith']);
      const result = isUserAllowed('Bob Johnson', config);

      expect(result).toBe(false);
    });

    it('should handle case-insensitive matching', () => {
      const config = createConfig(['John Doe', 'Jane Smith']);
      const result = isUserAllowed('john doe', config);

      expect(result).toBe(true);
    });

    it('should handle mixed case in allowlist', () => {
      const config = createConfig(['JOHN DOE', 'jane smith']);
      const result = isUserAllowed('John Doe', config);

      expect(result).toBe(true);
    });

    it('should deny user with undefined username', () => {
      const config = createConfig(['John Doe']);
      const result = isUserAllowed(undefined, config);

      expect(result).toBe(false);
    });

    it('should deny user with empty string username', () => {
      const config = createConfig(['John Doe']);
      const result = isUserAllowed('', config);

      expect(result).toBe(false);
    });
  });

  describe('Without allowlist configured', () => {
    it('should allow all users when allowlist is empty array', () => {
      const config = createConfig([]);
      const result = isUserAllowed('Anyone', config);

      expect(result).toBe(true);
    });

    it('should allow all users when allowlist is undefined', () => {
      const config = createConfig(undefined);
      const result = isUserAllowed('Anyone', config);

      expect(result).toBe(true);
    });

    it('should allow user even with undefined username when no allowlist', () => {
      const config = createConfig(undefined);
      const result = isUserAllowed(undefined, config);

      // When no allowlist, allow all users
      expect(result).toBe(true);
    });
  });

  describe('Outgoing Webhook disabled', () => {
    it('should deny all users when Outgoing Webhook is disabled', () => {
      const config = createConfig(['John Doe'], false);
      const result = isUserAllowed('John Doe', config);

      expect(result).toBe(false);
    });

    it('should deny users when Outgoing Webhook is disabled and no allowlist', () => {
      const config = createConfig(undefined, false);
      const result = isUserAllowed('Anyone', config);

      expect(result).toBe(false);
    });
  });

  describe('Config without outgoing_webhook settings', () => {
    it('should allow all users when outgoing_webhook is undefined', () => {
      const config: Config = {
        version: '1.0',
        environment: 'test',
        discovery: {
          method: 'tags',
          tags: { 'lights-out:managed': 'true' },
        },
        notifications: {
          teams: {
            enabled: true,
            webhook_url: 'https://example.com/webhook',
            // No outgoing_webhook config
          },
        },
      };

      const result = isUserAllowed('Anyone', config);

      expect(result).toBe(true);
    });

    it('should allow all users when notifications.teams is undefined', () => {
      const config: Config = {
        version: '1.0',
        environment: 'test',
        discovery: {
          method: 'tags',
          tags: { 'lights-out:managed': 'true' },
        },
        notifications: {
          // No teams config
        },
      };

      const result = isUserAllowed('Anyone', config);

      expect(result).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle allowlist with single user', () => {
      const config = createConfig(['John Doe']);

      expect(isUserAllowed('John Doe', config)).toBe(true);
      expect(isUserAllowed('Jane Smith', config)).toBe(false);
    });

    it('should handle usernames with special characters', () => {
      const config = createConfig(["John O'Brien", 'Jane-Smith']);

      expect(isUserAllowed("John O'Brien", config)).toBe(true);
      expect(isUserAllowed('Jane-Smith', config)).toBe(true);
    });

    it('should handle usernames with spaces', () => {
      const config = createConfig(['John   Doe']); // Multiple spaces
      const result = isUserAllowed('John   Doe', config);

      expect(result).toBe(true);
    });

    it('should not partially match usernames', () => {
      const config = createConfig(['John Doe']);

      expect(isUserAllowed('John', config)).toBe(false);
      expect(isUserAllowed('Doe', config)).toBe(false);
      expect(isUserAllowed('John Doe Smith', config)).toBe(false);
    });
  });
});
