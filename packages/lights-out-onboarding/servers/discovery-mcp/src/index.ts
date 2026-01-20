#!/usr/bin/env node
/**
 * AWS Resource Discovery MCP Server
 *
 * Provides tools for discovering AWS resources (ECS, RDS) and
 * generating Lights Out configuration recommendations.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { verifyCredentials } from './tools/verifyCredentials.js';
import { discoverEcsServices } from './tools/discoverEcs.js';
import { discoverRdsInstances } from './tools/discoverRds.js';
import { analyzeResources } from './tools/analyzeResources.js';
import {
  VerifyCredentialsInputSchema,
  DiscoverEcsInputSchema,
  DiscoverRdsInputSchema,
  AnalyzeResourcesInputSchema,
} from './types.js';

const server = new Server(
  {
    name: 'lights-out-discovery',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: { listChanged: false },
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'verify_credentials',
        description: 'Verify AWS credentials and return account identity information',
        inputSchema: {
          type: 'object',
          properties: {
            profile: {
              type: 'string',
              description: 'AWS profile name (optional, uses default credentials if not specified)',
            },
          },
        },
      },
      {
        name: 'discover_ecs_services',
        description:
          'Discover all ECS services in specified AWS regions, including Auto Scaling configuration and tags',
        inputSchema: {
          type: 'object',
          properties: {
            regions: {
              type: 'array',
              items: { type: 'string' },
              description: 'AWS regions to scan (e.g., ["ap-southeast-1", "us-east-1"])',
            },
          },
          required: ['regions'],
        },
      },
      {
        name: 'discover_rds_instances',
        description:
          'Discover all RDS instances in specified AWS regions, including tags and configuration',
        inputSchema: {
          type: 'object',
          properties: {
            regions: {
              type: 'array',
              items: { type: 'string' },
              description: 'AWS regions to scan (e.g., ["ap-southeast-1", "us-east-1"])',
            },
          },
          required: ['regions'],
        },
      },
      {
        name: 'analyze_resources',
        description:
          'Analyze discovered resources and generate Lights Out configuration recommendations with a markdown report',
        inputSchema: {
          type: 'object',
          properties: {
            resources: {
              type: 'object',
              properties: {
                ecs: {
                  type: 'array',
                  items: { type: 'object' },
                  description: 'ECS services from discover_ecs_services',
                },
                rds: {
                  type: 'array',
                  items: { type: 'object' },
                  description: 'RDS instances from discover_rds_instances',
                },
              },
              required: ['ecs', 'rds'],
            },
          },
          required: ['resources'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'verify_credentials': {
        const input = VerifyCredentialsInputSchema.parse(args);
        const result = await verifyCredentials(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'discover_ecs_services': {
        const input = DiscoverEcsInputSchema.parse(args);
        const result = await discoverEcsServices(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'discover_rds_instances': {
        const input = DiscoverRdsInputSchema.parse(args);
        const result = await discoverRdsInstances(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'analyze_resources': {
        const input = AnalyzeResourcesInputSchema.parse(args);
        const result = await analyzeResources(input);
        return {
          content: [
            {
              type: 'text',
              text: result.report,
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Lights Out Discovery MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
