/**
 * Generate IaC Tag Patch Tool
 *
 * Generates Infrastructure as Code (Terraform, CloudFormation, Serverless)
 * modification suggestions for adding Lights Out tags.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  GenerateIacTagPatchInput,
  GenerateIacTagPatchResult,
  IacTagPatch,
  LightsOutTags,
  ResourceToTag,
} from '../types.js';

/**
 * Extract service name from ECS ARN
 */
function extractServiceNameFromEcsArn(arn: string): string {
  // arn:aws:ecs:region:account:service/cluster/service-name
  const parts = arn.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Extract instance ID from RDS ARN
 */
function extractInstanceIdFromRdsArn(arn: string): string {
  // arn:aws:rds:region:account:db:instance-id
  const parts = arn.split(':');
  return parts[parts.length - 1] || '';
}

/**
 * Generate Terraform tags block snippet
 */
function generateTerraformTagsSnippet(tags: LightsOutTags, indent: string = '  '): string {
  const lines = [
    `${indent}tags = {`,
    `${indent}  "lights-out:managed"  = "${tags['lights-out:managed']}"`,
    `${indent}  "lights-out:project"  = "${tags['lights-out:project']}"`,
    `${indent}  "lights-out:priority" = "${tags['lights-out:priority']}"`,
    `${indent}}`,
  ];
  return lines.join('\n');
}

/**
 * Generate CloudFormation tags snippet (YAML)
 */
function generateCloudFormationTagsSnippet(tags: LightsOutTags, indent: string = '      '): string {
  const lines = [
    `${indent}Tags:`,
    `${indent}  - Key: "lights-out:managed"`,
    `${indent}    Value: "${tags['lights-out:managed']}"`,
    `${indent}  - Key: "lights-out:project"`,
    `${indent}    Value: "${tags['lights-out:project']}"`,
    `${indent}  - Key: "lights-out:priority"`,
    `${indent}    Value: "${tags['lights-out:priority']}"`,
  ];
  return lines.join('\n');
}

/**
 * Generate Serverless Framework tags snippet
 */
function generateServerlessTagsSnippet(tags: LightsOutTags, indent: string = '  '): string {
  const lines = [
    `${indent}tags:`,
    `${indent}  "lights-out:managed": "${tags['lights-out:managed']}"`,
    `${indent}  "lights-out:project": "${tags['lights-out:project']}"`,
    `${indent}  "lights-out:priority": "${tags['lights-out:priority']}"`,
  ];
  return lines.join('\n');
}

/**
 * Scan directory for IaC files
 */
function scanIacFiles(
  directory: string
): { path: string; type: 'terraform' | 'cloudformation' | 'serverless' }[] {
  const files: { path: string; type: 'terraform' | 'cloudformation' | 'serverless' }[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip common directories to avoid
      if (
        entry.isDirectory() &&
        ['node_modules', '.git', '.terraform', 'dist', 'build'].includes(entry.name)
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        // Terraform files
        if (entry.name.endsWith('.tf')) {
          files.push({ path: fullPath, type: 'terraform' });
        }
        // CloudFormation files
        else if (
          (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) &&
          !entry.name.includes('serverless')
        ) {
          // Check if it's CloudFormation by content
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes('AWSTemplateFormatVersion') || content.includes('AWS::')) {
            files.push({ path: fullPath, type: 'cloudformation' });
          }
        }
        // Serverless Framework
        else if (entry.name === 'serverless.yml' || entry.name === 'serverless.yaml') {
          files.push({ path: fullPath, type: 'serverless' });
        }
      }
    }
  }

  walk(directory);
  return files;
}

/**
 * Find Terraform resource for ECS service
 */
function findTerraformEcsResource(
  content: string,
  serviceName: string
): { found: boolean; lineNumber?: number; resourceName?: string } {
  const lines = content.split('\n');

  // Look for aws_ecs_service resources
  const servicePattern = /resource\s+"aws_ecs_service"\s+"([^"]+)"/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(servicePattern);
    if (match) {
      const resourceName = match[1];
      // Check if this resource references the service name
      // Look in the next ~30 lines for the name attribute
      const searchRange = lines.slice(i, i + 30).join('\n');
      if (searchRange.includes(serviceName) || resourceName.includes(serviceName)) {
        return { found: true, lineNumber: i + 1, resourceName };
      }
    }
  }

  return { found: false };
}

/**
 * Find Terraform resource for RDS instance
 */
function findTerraformRdsResource(
  content: string,
  instanceId: string
): { found: boolean; lineNumber?: number; resourceName?: string } {
  const lines = content.split('\n');

  // Look for aws_db_instance resources
  const instancePattern = /resource\s+"aws_db_instance"\s+"([^"]+)"/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(instancePattern);
    if (match) {
      const resourceName = match[1];
      const searchRange = lines.slice(i, i + 30).join('\n');
      if (searchRange.includes(instanceId) || resourceName.includes(instanceId)) {
        return { found: true, lineNumber: i + 1, resourceName };
      }
    }
  }

  return { found: false };
}

/**
 * Find CloudFormation resource
 */
function findCloudFormationResource(
  content: string,
  resourceName: string,
  resourceType: string
): { found: boolean; lineNumber?: number; logicalId?: string } {
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    // Look for resource type
    if (lines[i].includes(resourceType)) {
      // Check surrounding lines for the resource name
      const searchRange = lines.slice(Math.max(0, i - 10), i + 30).join('\n');
      if (searchRange.includes(resourceName)) {
        // Find the logical ID (the line before Type:)
        for (let j = i - 1; j >= 0; j--) {
          const logicalIdMatch = lines[j].match(/^\s{2}(\w+):\s*$/);
          if (logicalIdMatch) {
            return { found: true, lineNumber: j + 1, logicalId: logicalIdMatch[1] };
          }
        }
      }
    }
  }

  return { found: false };
}

/**
 * Generate patch for a resource
 */
function generatePatch(
  resource: ResourceToTag,
  iacFiles: { path: string; type: 'terraform' | 'cloudformation' | 'serverless' }[],
  iacDirectory: string,
  outputFormat: 'patch' | 'instructions'
): IacTagPatch | null {
  const resourceName =
    resource.type === 'ecs-service'
      ? extractServiceNameFromEcsArn(resource.arn)
      : extractInstanceIdFromRdsArn(resource.arn);

  for (const iacFile of iacFiles) {
    const content = fs.readFileSync(iacFile.path, 'utf-8');
    const relativePath = path.relative(iacDirectory, iacFile.path);

    if (iacFile.type === 'terraform') {
      const found =
        resource.type === 'ecs-service'
          ? findTerraformEcsResource(content, resourceName)
          : findTerraformRdsResource(content, resourceName);

      if (found.found) {
        const patchSnippet =
          outputFormat === 'patch' ? generateTerraformTagsSnippet(resource.tags) : undefined;

        return {
          filePath: iacFile.path,
          iacType: 'terraform',
          resourceIdentifier: found.resourceName || resourceName,
          suggestedTags: resource.tags,
          lineNumber: found.lineNumber,
          patchSnippet,
          instructions:
            outputFormat === 'instructions'
              ? `In file ${relativePath}, find resource "${found.resourceName}" (around line ${found.lineNumber}) and add the following tags block:\n\n${generateTerraformTagsSnippet(resource.tags)}`
              : `Add tags block to resource "${found.resourceName}"`,
        };
      }
    } else if (iacFile.type === 'cloudformation') {
      const cfnType =
        resource.type === 'ecs-service' ? 'AWS::ECS::Service' : 'AWS::RDS::DBInstance';
      const found = findCloudFormationResource(content, resourceName, cfnType);

      if (found.found) {
        const patchSnippet =
          outputFormat === 'patch' ? generateCloudFormationTagsSnippet(resource.tags) : undefined;

        return {
          filePath: iacFile.path,
          iacType: 'cloudformation',
          resourceIdentifier: found.logicalId || resourceName,
          suggestedTags: resource.tags,
          lineNumber: found.lineNumber,
          patchSnippet,
          instructions:
            outputFormat === 'instructions'
              ? `In file ${relativePath}, find resource "${found.logicalId}" (around line ${found.lineNumber}) and add the following Tags property:\n\n${generateCloudFormationTagsSnippet(resource.tags)}`
              : `Add Tags to resource "${found.logicalId}"`,
        };
      }
    } else if (iacFile.type === 'serverless') {
      // Serverless Framework - typically provider-level tags
      if (content.includes('provider:')) {
        return {
          filePath: iacFile.path,
          iacType: 'serverless',
          resourceIdentifier: 'provider',
          suggestedTags: resource.tags,
          instructions:
            outputFormat === 'instructions'
              ? `In file ${relativePath}, add the following under the provider section:\n\n${generateServerlessTagsSnippet(resource.tags)}\n\nNote: Serverless Framework applies provider-level tags to all resources. For resource-specific tags, you may need to use CloudFormation resources.`
              : 'Add tags to provider section',
        };
      }
    }
  }

  return null;
}

/**
 * Generates IaC tag modification suggestions.
 *
 * @param input - Input parameters
 * @returns IaC patches and instructions
 */
export async function generateIacTagPatch(
  input: GenerateIacTagPatchInput
): Promise<GenerateIacTagPatchResult> {
  const { iacDirectory, resources, outputFormat = 'instructions' } = input;

  try {
    // Check if directory exists
    if (!fs.existsSync(iacDirectory)) {
      return {
        success: false,
        error: `IaC directory not found: ${iacDirectory}`,
        iacDirectory,
        patches: [],
        summary: {
          totalPatches: 0,
          terraform: 0,
          cloudformation: 0,
          serverless: 0,
          notFound: resources.length,
        },
        notFoundResources: resources.map((r) => r.arn),
      };
    }

    // Scan for IaC files
    const iacFiles = scanIacFiles(iacDirectory);

    if (iacFiles.length === 0) {
      return {
        success: false,
        error: 'No IaC files found in the specified directory',
        iacDirectory,
        patches: [],
        summary: {
          totalPatches: 0,
          terraform: 0,
          cloudformation: 0,
          serverless: 0,
          notFound: resources.length,
        },
        notFoundResources: resources.map((r) => r.arn),
      };
    }

    const patches: IacTagPatch[] = [];
    const notFoundResources: string[] = [];
    let terraform = 0;
    let cloudformation = 0;
    let serverless = 0;

    for (const resource of resources) {
      const patch = generatePatch(resource, iacFiles, iacDirectory, outputFormat);

      if (patch) {
        patches.push(patch);
        switch (patch.iacType) {
          case 'terraform':
            terraform++;
            break;
          case 'cloudformation':
            cloudformation++;
            break;
          case 'serverless':
            serverless++;
            break;
        }
      } else {
        notFoundResources.push(resource.arn);
      }
    }

    return {
      success: true,
      iacDirectory,
      patches,
      summary: {
        totalPatches: patches.length,
        terraform,
        cloudformation,
        serverless,
        notFound: notFoundResources.length,
      },
      notFoundResources,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to generate patches: ${errorMessage}`,
      iacDirectory,
      patches: [],
      summary: {
        totalPatches: 0,
        terraform: 0,
        cloudformation: 0,
        serverless: 0,
        notFound: resources.length,
      },
      notFoundResources: resources.map((r) => r.arn),
    };
  }
}
