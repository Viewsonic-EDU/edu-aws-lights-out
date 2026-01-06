/**
 * Unit tests for functions/teams-notifier/adaptiveCard.ts
 *
 * Tests Adaptive Card generation logic for Microsoft Teams notifications.
 */

import { describe, it, expect } from 'vitest';
import {
  createStateChangeCard,
  type ResourceStateChange,
} from '@functions/teams-notifier/adaptiveCard';

describe('adaptiveCard', () => {
  describe('createStateChangeCard', () => {
    it('should create a valid Adaptive Card for ECS service state change', () => {
      const data: ResourceStateChange = {
        project: 'airsync-dev',
        resourceType: 'ecs-service',
        resourceId: 'airsync-api',
        previousState: 'STOPPED',
        newState: 'RUNNING',
        timestamp: '2026-01-05T10:30:00Z',
        additionalInfo: {
          cluster: 'airsync-cluster',
          tasks: '2/2 healthy',
        },
      };

      const card = createStateChangeCard(data);

      expect(card).toHaveProperty('type', 'message');
      expect(card).toHaveProperty('attachments');
      expect(Array.isArray((card as any).attachments)).toBe(true);

      const attachment = (card as any).attachments[0];
      expect(attachment.contentType).toBe('application/vnd.microsoft.card.adaptive');
      expect(attachment.content.$schema).toBe('http://adaptivecards.io/schemas/adaptive-card.json');
      expect(attachment.content.type).toBe('AdaptiveCard');
      expect(attachment.content.version).toBe('1.4');

      // Check body structure
      const body = attachment.content.body;
      expect(body).toHaveLength(2); // TextBlock + FactSet

      // Check title
      const title = body[0];
      expect(title.type).toBe('TextBlock');
      expect(title.text).toContain('airsync-dev');
      expect(title.text).toContain('Status Update');
      expect(title.weight).toBe('Bolder');

      // Check facts
      const factSet = body[1];
      expect(factSet.type).toBe('FactSet');
      expect(Array.isArray(factSet.facts)).toBe(true);
      expect(factSet.facts.length).toBeGreaterThan(0);

      // Verify required facts
      const factTitles = (factSet.facts as Array<{ title: string; value: string }>).map(
        (f) => f.title
      );
      expect(factTitles).toContain('Resource Type');
      expect(factTitles).toContain('Resource ID');
      expect(factTitles).toContain('Previous State');
      expect(factTitles).toContain('New State');
      expect(factTitles).toContain('Timestamp');

      // Verify additional info
      expect(factTitles).toContain('Cluster');
      expect(factTitles).toContain('Tasks');
    });

    it('should format resource type correctly', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'stopped',
        newState: 'running',
        timestamp: '2026-01-05T10:30:00Z',
      };

      const card = createStateChangeCard(data);
      const factSet = (card as any).attachments[0].content.body[1];
      const resourceTypeFact = (factSet.facts as Array<{ title: string; value: string }>).find(
        (f) => f.title === 'Resource Type'
      );

      expect(resourceTypeFact?.value).toBe('ECS SERVICE');
    });

    it('should format RDS resource type correctly', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'rds-instance',
        resourceId: 'test-db',
        previousState: 'available',
        newState: 'stopped',
        timestamp: '2026-01-05T10:30:00Z',
      };

      const card = createStateChangeCard(data);
      const factSet = (card as any).attachments[0].content.body[1];
      const resourceTypeFact = (factSet.facts as Array<{ title: string; value: string }>).find(
        (f) => f.title === 'Resource Type'
      );

      expect(resourceTypeFact?.value).toBe('RDS INSTANCE');
    });

    it('should apply correct color for RUNNING state', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'STOPPED',
        newState: 'RUNNING',
        timestamp: '2026-01-05T10:30:00Z',
      };

      const card = createStateChangeCard(data);
      const title = (card as any).attachments[0].content.body[0];

      expect(title.color).toBe('Good'); // Green for running
      expect(title.text).toContain('🟢'); // Green emoji
    });

    it('should apply correct color for STOPPED state', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'RUNNING',
        newState: 'STOPPED',
        timestamp: '2026-01-05T10:30:00Z',
      };

      const card = createStateChangeCard(data);
      const title = (card as any).attachments[0].content.body[0];

      expect(title.color).toBe('Attention'); // Red for stopped
      expect(title.text).toContain('🔴'); // Red emoji
    });

    it('should apply correct color for PENDING state', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'STOPPED',
        newState: 'PENDING',
        timestamp: '2026-01-05T10:30:00Z',
      };

      const card = createStateChangeCard(data);
      const title = (card as any).attachments[0].content.body[0];

      expect(title.color).toBe('Warning'); // Yellow for pending
      expect(title.text).toContain('🟡'); // Yellow emoji
    });

    it('should apply correct color for FAILED state', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'RUNNING',
        newState: 'FAILED',
        timestamp: '2026-01-05T10:30:00Z',
      };

      const card = createStateChangeCard(data);
      const title = (card as any).attachments[0].content.body[0];

      expect(title.color).toBe('Attention'); // Red for failed
      expect(title.text).toContain('❌'); // Error emoji
    });

    it('should apply default color for unknown state', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'unknown',
        newState: 'CUSTOM_STATE',
        timestamp: '2026-01-05T10:30:00Z',
      };

      const card = createStateChangeCard(data);
      const title = (card as any).attachments[0].content.body[0];

      expect(title.color).toBe('Default'); // Gray for unknown
      expect(title.text).toContain('⚪'); // White emoji
    });

    it('should format timestamp correctly', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'stopped',
        newState: 'running',
        timestamp: '2026-01-05T14:30:45Z',
      };

      const card = createStateChangeCard(data);
      const factSet = (card as any).attachments[0].content.body[1];
      const timestampFact = (factSet.facts as Array<{ title: string; value: string }>).find(
        (f) => f.title === 'Timestamp'
      );

      expect(timestampFact?.value).toBe('2026-01-05 14:30:45 UTC');
    });

    it('should format field names from camelCase to Title Case', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'stopped',
        newState: 'running',
        timestamp: '2026-01-05T10:30:00Z',
        additionalInfo: {
          clusterName: 'my-cluster',
          taskCount: '5',
        },
      };

      const card = createStateChangeCard(data);
      const factSet = (card as any).attachments[0].content.body[1];
      const factTitles = (factSet.facts as Array<{ title: string; value: string }>).map(
        (f) => f.title
      );

      expect(factTitles).toContain('Cluster Name');
      expect(factTitles).toContain('Task Count');
    });

    it('should format field names from snake_case to Title Case', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'stopped',
        newState: 'running',
        timestamp: '2026-01-05T10:30:00Z',
        additionalInfo: {
          cluster_name: 'my-cluster',
          task_count: '5',
        },
      };

      const card = createStateChangeCard(data);
      const factSet = (card as any).attachments[0].content.body[1];
      const factTitles = (factSet.facts as Array<{ title: string; value: string }>).map(
        (f) => f.title
      );

      expect(factTitles).toContain('Cluster Name');
      expect(factTitles).toContain('Task Count');
    });

    it('should handle missing additionalInfo gracefully', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'stopped',
        newState: 'running',
        timestamp: '2026-01-05T10:30:00Z',
      };

      const card = createStateChangeCard(data);
      const factSet = (card as any).attachments[0].content.body[1];

      // Should only have base facts
      expect(factSet.facts.length).toBe(5); // Resource Type, ID, Previous, New, Timestamp
    });

    it('should handle empty additionalInfo object', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'stopped',
        newState: 'running',
        timestamp: '2026-01-05T10:30:00Z',
        additionalInfo: {},
      };

      const card = createStateChangeCard(data);
      const factSet = (card as any).attachments[0].content.body[1];

      // Should only have base facts
      expect(factSet.facts.length).toBe(5);
    });

    it('should handle case-insensitive state matching', () => {
      const testCases = [
        { state: 'running', expectedColor: 'Good' },
        { state: 'RUNNING', expectedColor: 'Good' },
        { state: 'Running', expectedColor: 'Good' },
        { state: 'stopped', expectedColor: 'Attention' },
        { state: 'STOPPED', expectedColor: 'Attention' },
        { state: 'Stopped', expectedColor: 'Attention' },
      ];

      testCases.forEach(({ state, expectedColor }) => {
        const data: ResourceStateChange = {
          project: 'test-project',
          resourceType: 'ecs-service',
          resourceId: 'test-resource',
          previousState: 'unknown',
          newState: state,
          timestamp: '2026-01-05T10:30:00Z',
        };

        const card = createStateChangeCard(data);
        const title = (card as any).attachments[0].content.body[0];

        expect(title.color).toBe(expectedColor);
      });
    });

    it('should bold the new state in facts', () => {
      const data: ResourceStateChange = {
        project: 'test-project',
        resourceType: 'ecs-service',
        resourceId: 'test-resource',
        previousState: 'STOPPED',
        newState: 'RUNNING',
        timestamp: '2026-01-05T10:30:00Z',
      };

      const card = createStateChangeCard(data);
      const factSet = (card as any).attachments[0].content.body[1];
      const newStateFact = (factSet.facts as Array<{ title: string; value: string }>).find(
        (f) => f.title === 'New State'
      );

      expect(newStateFact).toBeDefined();
      expect(newStateFact?.value).toContain('**');
      expect(newStateFact?.value).toContain('RUNNING');
    });
  });
});
