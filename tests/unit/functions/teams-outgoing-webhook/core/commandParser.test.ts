import { describe, it, expect } from 'vitest';
import { parseCommand } from '@functions/teams-outgoing-webhook/core/commandParser';

describe('commandParser', () => {
  describe('Valid commands', () => {
    it('should parse start command', () => {
      const result = parseCommand('<at>LightsOut</at> start');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('start');
      expect(result.error).toBeUndefined();
    });

    it('should parse stop command', () => {
      const result = parseCommand('<at>LightsOut</at> stop');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('stop');
      expect(result.error).toBeUndefined();
    });

    it('should parse status command', () => {
      const result = parseCommand('@LightsOut status');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('status');
    });

    it('should parse discover command', () => {
      const result = parseCommand('@LightsOut discover');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('discover');
    });

    it('should handle multiple spaces', () => {
      const result = parseCommand('<at>LightsOut</at>   start');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('start');
    });

    it('should handle case-insensitive actions', () => {
      const result = parseCommand('@LightsOut START');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('start');
    });

    it('should handle mixed case actions', () => {
      const result = parseCommand('@LightsOut StOp');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('stop');
    });
  });

  describe('Invalid commands', () => {
    it('should reject empty command text', () => {
      const result = parseCommand('');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Empty command');
    });

    it('should reject command with only bot mention', () => {
      const result = parseCommand('<at>LightsOut</at>');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('No command specified');
    });

    it('should reject unknown action', () => {
      const result = parseCommand('@LightsOut invalid-action');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown action');
      expect(result.error).toContain('invalid-action');
    });

    it('should reject whitespace-only command', () => {
      const result = parseCommand('   ');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Help command', () => {
    it('should return help message for help command', () => {
      const result = parseCommand('@LightsOut help');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Available Commands');
      expect(result.error).toContain('start');
      expect(result.error).toContain('stop');
      expect(result.error).toContain('status');
      expect(result.error).toContain('discover');
    });

    it('should handle help command with different case', () => {
      const result = parseCommand('@LightsOut HELP');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Available Commands');
    });
  });

  describe('Bot mention removal', () => {
    it('should handle XML-style mention', () => {
      const result = parseCommand('<at>LightsOut</at> start');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('start');
    });

    it('should handle @-style mention', () => {
      const result = parseCommand('@LightsOut start');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('start');
    });

    it('should handle multiple mentions', () => {
      const result = parseCommand('@LightsOut @AnotherBot start');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('start');
    });
  });

  describe('Edge cases', () => {
    it('should handle command with leading/trailing spaces', () => {
      const result = parseCommand('  @LightsOut start  ');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('start');
    });

    it('should ignore extra arguments after action', () => {
      const result = parseCommand('@LightsOut start extra-arg ignored-arg');

      expect(result.valid).toBe(true);
      expect(result.action).toBe('start');
      // Extra arguments are ignored (no targetGroup in schema A)
    });
  });
});
