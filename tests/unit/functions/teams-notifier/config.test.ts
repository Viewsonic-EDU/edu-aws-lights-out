/**
 * Unit tests for functions/teams-notifier/config.ts
 *
 * Tests DynamoDB configuration management with caching for Teams integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  getProjectConfig,
  clearConfigCache,
  type TeamsConfig,
} from '@functions/teams-notifier/config';

const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('teams-notifier/config', () => {
  const originalEnv = process.env.TEAMS_CONFIG_TABLE;

  beforeEach(() => {
    dynamoMock.reset();
    clearConfigCache(); // Clear cache before each test
    process.env.TEAMS_CONFIG_TABLE = 'test-teams-config';
  });

  afterEach(() => {
    process.env.TEAMS_CONFIG_TABLE = originalEnv;
  });

  describe('getProjectConfig', () => {
    it('should retrieve config from DynamoDB on cache miss', async () => {
      const mockConfig: TeamsConfig = {
        project: 'airsync-dev',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      dynamoMock.on(GetCommand).resolves({
        Item: mockConfig,
      });

      const config = await getProjectConfig('airsync-dev');

      expect(config).toEqual(mockConfig);

      // Verify DynamoDB was called with correct parameters
      const calls = dynamoMock.commandCalls(GetCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toEqual({
        TableName: 'test-teams-config',
        Key: { project: 'airsync-dev' },
      });
    });

    it('should return cached config on subsequent calls (cache hit)', async () => {
      const mockConfig: TeamsConfig = {
        project: 'airsync-dev',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      dynamoMock.on(GetCommand).resolves({
        Item: mockConfig,
      });

      // First call - cache miss
      const config1 = await getProjectConfig('airsync-dev');
      expect(config1).toEqual(mockConfig);

      // Second call - cache hit (should NOT call DynamoDB)
      const config2 = await getProjectConfig('airsync-dev');
      expect(config2).toEqual(mockConfig);

      // Verify DynamoDB was only called once
      const calls = dynamoMock.commandCalls(GetCommand);
      expect(calls).toHaveLength(1);
    });

    it('should return null when project config not found', async () => {
      dynamoMock.on(GetCommand).resolves({
        Item: undefined, // No config found
      });

      const config = await getProjectConfig('nonexistent-project');

      expect(config).toBeNull();
    });

    it('should return null when webhook_url is missing', async () => {
      dynamoMock.on(GetCommand).resolves({
        Item: {
          project: 'airsync-dev',
          // webhook_url is missing
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-05T00:00:00Z',
        },
      });

      const config = await getProjectConfig('airsync-dev');

      expect(config).toBeNull();
    });

    it('should return null when TEAMS_CONFIG_TABLE env var is not set', async () => {
      delete process.env.TEAMS_CONFIG_TABLE;

      const config = await getProjectConfig('airsync-dev');

      expect(config).toBeNull();

      // DynamoDB should NOT be called
      const calls = dynamoMock.commandCalls(GetCommand);
      expect(calls).toHaveLength(0);
    });

    it('should handle DynamoDB errors gracefully', async () => {
      dynamoMock.on(GetCommand).rejects(new Error('DynamoDB service error'));

      const config = await getProjectConfig('airsync-dev');

      expect(config).toBeNull();
    });

    it('should cache multiple projects independently', async () => {
      const config1: TeamsConfig = {
        project: 'project-a',
        webhook_url: 'https://outlook.office.com/webhook/aaa',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      const config2: TeamsConfig = {
        project: 'project-b',
        webhook_url: 'https://outlook.office.com/webhook/bbb',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      dynamoMock
        .on(GetCommand, {
          TableName: 'test-teams-config',
          Key: { project: 'project-a' },
        })
        .resolves({ Item: config1 })
        .on(GetCommand, {
          TableName: 'test-teams-config',
          Key: { project: 'project-b' },
        })
        .resolves({ Item: config2 });

      // Fetch both configs
      const result1 = await getProjectConfig('project-a');
      const result2 = await getProjectConfig('project-b');

      expect(result1).toEqual(config1);
      expect(result2).toEqual(config2);

      // Both should be cached - subsequent calls should NOT hit DynamoDB
      await getProjectConfig('project-a');
      await getProjectConfig('project-b');

      // Verify only 2 DynamoDB calls (one per project)
      const calls = dynamoMock.commandCalls(GetCommand);
      expect(calls).toHaveLength(2);
    });

    it('should refetch after cache expires (10 minutes)', async () => {
      vi.useFakeTimers();

      const mockConfig: TeamsConfig = {
        project: 'airsync-dev',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      dynamoMock.on(GetCommand).resolves({
        Item: mockConfig,
      });

      // First call - cache miss
      await getProjectConfig('airsync-dev');

      // Advance time by 5 minutes (within TTL)
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Second call - should still use cache
      await getProjectConfig('airsync-dev');

      // Verify only 1 DynamoDB call so far
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(1);

      // Advance time by 6 more minutes (total 11 minutes, beyond 10-minute TTL)
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Third call - cache expired, should refetch
      await getProjectConfig('airsync-dev');

      // Verify 2 DynamoDB calls now
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(2);

      vi.useRealTimers();
    });
  });

  describe('clearConfigCache', () => {
    it('should clear cache for specific project', async () => {
      const mockConfig: TeamsConfig = {
        project: 'airsync-dev',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      dynamoMock.on(GetCommand).resolves({
        Item: mockConfig,
      });

      // Fetch to populate cache
      await getProjectConfig('airsync-dev');
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(1);

      // Fetch again - should use cache
      await getProjectConfig('airsync-dev');
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(1);

      // Clear cache for this project
      clearConfigCache('airsync-dev');

      // Fetch again - should refetch from DynamoDB
      await getProjectConfig('airsync-dev');
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(2);
    });

    it('should clear all caches when no project specified', async () => {
      const config1: TeamsConfig = {
        project: 'project-a',
        webhook_url: 'https://outlook.office.com/webhook/aaa',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      const config2: TeamsConfig = {
        project: 'project-b',
        webhook_url: 'https://outlook.office.com/webhook/bbb',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      dynamoMock
        .on(GetCommand, {
          TableName: 'test-teams-config',
          Key: { project: 'project-a' },
        })
        .resolves({ Item: config1 })
        .on(GetCommand, {
          TableName: 'test-teams-config',
          Key: { project: 'project-b' },
        })
        .resolves({ Item: config2 });

      // Fetch both to populate cache
      await getProjectConfig('project-a');
      await getProjectConfig('project-b');
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(2);

      // Fetch again - should use cache
      await getProjectConfig('project-a');
      await getProjectConfig('project-b');
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(2);

      // Clear all caches
      clearConfigCache();

      // Fetch again - should refetch both from DynamoDB
      await getProjectConfig('project-a');
      await getProjectConfig('project-b');
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(4);
    });

    it('should not affect other projects when clearing specific project', async () => {
      const config1: TeamsConfig = {
        project: 'project-a',
        webhook_url: 'https://outlook.office.com/webhook/aaa',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      const config2: TeamsConfig = {
        project: 'project-b',
        webhook_url: 'https://outlook.office.com/webhook/bbb',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };

      dynamoMock
        .on(GetCommand, {
          TableName: 'test-teams-config',
          Key: { project: 'project-a' },
        })
        .resolves({ Item: config1 })
        .on(GetCommand, {
          TableName: 'test-teams-config',
          Key: { project: 'project-b' },
        })
        .resolves({ Item: config2 });

      // Fetch both to populate cache
      await getProjectConfig('project-a');
      await getProjectConfig('project-b');
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(2);

      // Clear cache for project-a only
      clearConfigCache('project-a');

      // Fetch both again
      await getProjectConfig('project-a'); // Should refetch
      await getProjectConfig('project-b'); // Should use cache

      // Verify project-a refetched, project-b still cached
      expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(3);
    });
  });
});
