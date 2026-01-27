/**
 * IaC Directory Scanner Tool
 *
 * Scans a directory for Infrastructure as Code files (Terraform, CloudFormation, Terragrunt)
 * and extracts resource definitions to provide context for Lights Out analysis.
 *
 * Uses the IaC Plugin Registry for type detection, while maintaining its own
 * resource extraction and dependency analysis logic.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  IacScanResult,
  IacResourceDefinition,
  IacFileInfo,
  IacResourceCategory,
  DependencyEdge,
  IacType,
} from '../types.js';
import { globalRegistry } from './iac-plugins/index.js';

// ============================================================================
// Resource Patterns (for broad exploration - more types than Plugin system)
// ============================================================================

/**
 * Resource type patterns to look for
 * Note: This covers more resource types than the Plugin system (which only handles ECS/RDS)
 */
const RESOURCE_PATTERNS: Record<IacResourceCategory, RegExp[]> = {
  ecs: [
    /resource\s+"aws_ecs_service"/g,
    /resource\s+"aws_ecs_cluster"/g,
    /resource\s+"aws_ecs_task_definition"/g,
    /AWS::ECS::Service/g,
    /AWS::ECS::Cluster/g,
    /AWS::ECS::TaskDefinition/g,
  ],
  rds: [
    /resource\s+"aws_db_instance"/g,
    /resource\s+"aws_rds_cluster"/g,
    /resource\s+"aws_rds_cluster_instance"/g,
    /AWS::RDS::DBInstance/g,
    /AWS::RDS::DBCluster/g,
  ],
  autoscaling: [
    /resource\s+"aws_appautoscaling_target"/g,
    /resource\s+"aws_appautoscaling_policy"/g,
    /AWS::ApplicationAutoScaling::ScalableTarget/g,
  ],
  security_group: [
    /resource\s+"aws_security_group"/g,
    /resource\s+"aws_security_group_rule"/g,
    /AWS::EC2::SecurityGroup/g,
  ],
  service_discovery: [
    /resource\s+"aws_service_discovery_service"/g,
    /resource\s+"aws_service_discovery_private_dns_namespace"/g,
    /AWS::ServiceDiscovery::Service/g,
    /AWS::ServiceDiscovery::PrivateDnsNamespace/g,
  ],
  load_balancer: [
    /resource\s+"aws_lb"/g,
    /resource\s+"aws_alb"/g,
    /resource\s+"aws_lb_target_group"/g,
    /resource\s+"aws_lb_listener"/g,
    /AWS::ElasticLoadBalancingV2::LoadBalancer/g,
    /AWS::ElasticLoadBalancingV2::TargetGroup/g,
    /AWS::ElasticLoadBalancingV2::Listener/g,
  ],
};

// ============================================================================
// Fallback File Discovery (when no plugin matches or for additional files)
// ============================================================================

const SKIP_DIRS = [
  'node_modules',
  '.git',
  '.terraform',
  '.terragrunt-cache',
  'vendor',
  'dist',
  'build',
];

/**
 * Fallback file discovery for when plugins don't provide complete file lists
 * or for IaC types not covered by plugins
 */
function discoverIacFiles(
  dir: string,
  maxDepth: number = 5,
  currentDepth: number = 0
): IacFileInfo[] {
  const files: IacFileInfo[] = [];

  if (currentDepth > maxDepth) {
    return files;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.includes(entry.name)) {
          files.push(...discoverIacFiles(fullPath, maxDepth, currentDepth + 1));
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name);
      const fileName = entry.name;

      let iacType: IacType | null = null;

      // Terragrunt files (most specific first)
      if (fileName === 'terragrunt.hcl' || fileName === 'terragrunt.stack.hcl') {
        iacType = 'terragrunt';
      }
      // Terraform files
      else if (fileName.endsWith('.tf') || fileName.endsWith('.tf.json')) {
        iacType = 'terraform';
      }
      // Serverless Framework
      else if (fileName === 'serverless.yml' || fileName === 'serverless.yaml') {
        iacType = 'serverless';
      }
      // CloudFormation (need content check)
      else if (['.yaml', '.yml', '.json', '.template'].includes(ext)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 1000);
          if (
            content.includes('AWSTemplateFormatVersion') ||
            content.includes('Resources:') ||
            content.includes('"Resources"') ||
            content.includes('AWS::')
          ) {
            iacType = 'cloudformation';
          }
        } catch {
          // Skip files we can't read
        }
      }

      if (iacType) {
        files.push({
          path: fullPath,
          relativePath: path.relative(dir, fullPath),
          type: iacType,
          fileName: entry.name,
        });
      }
    }
  } catch {
    // Directory not accessible, skip
  }

  return files;
}

// ============================================================================
// Resource Extraction Helpers
// ============================================================================

/**
 * Get line number from character index
 */
function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * Extract resource block content from Terraform file
 */
function extractTerraformResourceBlock(content: string, startIndex: number): string {
  let braceCount = 0;
  let started = false;
  let blockStart = startIndex;
  let blockEnd = startIndex;

  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '{') {
      if (!started) {
        started = true;
        blockStart = i;
      }
      braceCount++;
    } else if (content[i] === '}') {
      braceCount--;
      if (started && braceCount === 0) {
        blockEnd = i + 1;
        break;
      }
    }
  }

  return content.slice(blockStart, blockEnd);
}

/**
 * Extract references from a Terraform resource block
 */
function extractTerraformReferences(block: string): string[] {
  const references: string[] = [];
  const attrRefPattern = /([a-z_]+\.[a-z0-9_-]+)(?:\.[a-z_]+)?/g;
  const matches = block.matchAll(attrRefPattern);

  for (const match of matches) {
    const ref = match[1];
    if (
      !ref.startsWith('var.') &&
      !ref.startsWith('local.') &&
      !ref.startsWith('data.') &&
      !ref.startsWith('module.') &&
      !ref.includes('.tf') &&
      ref.includes('_')
    ) {
      if (!references.includes(ref)) {
        references.push(ref);
      }
    }
  }

  return references;
}

/**
 * Extract depends_on from a Terraform resource block
 */
function extractTerraformDependsOn(block: string): string[] {
  const dependsOn: string[] = [];
  const pattern = /depends_on\s*=\s*\[([\s\S]*?)\]/g;

  const matches = block.matchAll(pattern);
  for (const match of matches) {
    const deps = match[1];
    const refPattern = /([a-z_]+\.[a-z0-9_-]+)/g;
    const refMatches = deps.matchAll(refPattern);
    for (const refMatch of refMatches) {
      if (!dependsOn.includes(refMatch[1])) {
        dependsOn.push(refMatch[1]);
      }
    }
  }

  return dependsOn;
}

/**
 * Extract security group references from a Terraform resource block
 */
function extractTerraformSecurityGroups(block: string): string[] {
  const securityGroups: string[] = [];
  const patterns = [
    /security_groups\s*=\s*\[([\s\S]*?)\]/g,
    /vpc_security_group_ids\s*=\s*\[([\s\S]*?)\]/g,
    /security_group_ids\s*=\s*\[([\s\S]*?)\]/g,
  ];

  for (const pattern of patterns) {
    const matches = block.matchAll(pattern);
    for (const match of matches) {
      const sgs = match[1];
      const refPattern = /([a-z_]+\.[a-z0-9_-]+)/g;
      const refMatches = sgs.matchAll(refPattern);
      for (const refMatch of refMatches) {
        if (!securityGroups.includes(refMatch[1])) {
          securityGroups.push(refMatch[1]);
        }
      }
    }
  }

  return securityGroups;
}

/**
 * Extract a code snippet around a match
 */
function extractSnippet(content: string, lineNumber: number, contextLines: number = 5): string {
  const lines = content.split('\n');
  const start = Math.max(0, lineNumber - contextLines - 1);
  const end = Math.min(lines.length, lineNumber + contextLines);
  return lines.slice(start, end).join('\n');
}

/**
 * Extract resource definitions from file content
 */
function extractResources(
  content: string,
  filePath: string,
  isTerraform: boolean
): IacResourceDefinition[] {
  const resources: IacResourceDefinition[] = [];

  // Build a map of resource names for Terraform files
  const resourceNameMap = new Map<number, { type: string; name: string }>();
  if (isTerraform) {
    const namePattern = /resource\s+"([^"]+)"\s+"([^"]+)"/g;
    const nameMatches = content.matchAll(namePattern);
    for (const match of nameMatches) {
      const lineNumber = getLineNumber(content, match.index || 0);
      resourceNameMap.set(lineNumber, {
        type: match[1],
        name: match[2],
      });
    }
  }

  // Check all resource categories
  for (const [category, patterns] of Object.entries(RESOURCE_PATTERNS) as [
    IacResourceCategory,
    RegExp[],
  ][]) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const lineNumber = getLineNumber(content, match.index || 0);
        const resource: IacResourceDefinition = {
          type: category,
          resourceType: match[0],
          file: filePath,
          lineNumber,
        };

        // For Terraform files, extract additional information
        if (isTerraform && match.index !== undefined) {
          const nameInfo = resourceNameMap.get(lineNumber);
          if (nameInfo) {
            resource.resourceName = nameInfo.name;
            const block = extractTerraformResourceBlock(content, match.index);

            const references = extractTerraformReferences(block);
            if (references.length > 0) {
              resource.references = references;
            }

            const dependsOn = extractTerraformDependsOn(block);
            if (dependsOn.length > 0) {
              resource.dependsOn = dependsOn;
            }

            const securityGroups = extractTerraformSecurityGroups(block);
            if (securityGroups.length > 0) {
              resource.securityGroups = securityGroups;
            }
          }
        }

        resources.push(resource);
      }
    }
  }

  return resources;
}

/**
 * Build dependency edges from extracted resources
 */
function buildDependencyEdges(resources: IacResourceDefinition[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const resourceMap = new Map<string, IacResourceDefinition>();

  // Build a map of resource identifiers
  for (const resource of resources) {
    if (resource.resourceName) {
      const resourceTypeMatch = resource.resourceType.match(/"([^"]+)"/);
      if (resourceTypeMatch) {
        const key = `${resourceTypeMatch[1]}.${resource.resourceName}`;
        resourceMap.set(key, resource);
      }
    }
  }

  // Build edges from dependencies
  for (const resource of resources) {
    if (!resource.resourceName) continue;

    const resourceTypeMatch = resource.resourceType.match(/"([^"]+)"/);
    if (!resourceTypeMatch) continue;

    const fromKey = `${resourceTypeMatch[1]}.${resource.resourceName}`;

    // Add depends_on edges
    if (resource.dependsOn) {
      for (const dep of resource.dependsOn) {
        if (resourceMap.has(dep)) {
          edges.push({
            from: fromKey,
            to: dep,
            type: 'depends_on',
            confidence: 'high',
            evidence: `${resource.file}:${resource.lineNumber}`,
          });
        }
      }
    }

    // Add reference edges
    if (resource.references) {
      for (const ref of resource.references) {
        if (resourceMap.has(ref) && ref !== fromKey) {
          const existingEdge = edges.find((e) => e.from === fromKey && e.to === ref);
          if (!existingEdge) {
            edges.push({
              from: fromKey,
              to: ref,
              type: 'reference',
              confidence: 'medium',
              evidence: `${resource.file}:${resource.lineNumber}`,
            });
          }
        }
      }
    }

    // Add security group edges
    if (resource.securityGroups) {
      for (const sg of resource.securityGroups) {
        if (resourceMap.has(sg)) {
          edges.push({
            from: fromKey,
            to: sg,
            type: 'security_group',
            confidence: 'high',
            evidence: `${resource.file}:${resource.lineNumber}`,
          });
        }
      }
    }
  }

  return edges;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Scan a directory for IaC files and extract resource definitions.
 *
 * Uses the IaC Plugin Registry for type detection when available,
 * with fallback to direct file discovery.
 */
export async function scanIacDirectory(input: {
  directory: string;
  includeSnippets?: boolean;
}): Promise<IacScanResult> {
  const { directory, includeSnippets = false } = input;

  // Default empty summary
  const emptySummary = {
    totalFiles: 0,
    terraform: 0,
    terragrunt: 0,
    cloudformation: 0,
    ecsResources: 0,
    rdsResources: 0,
    autoscalingResources: 0,
    securityGroupResources: 0,
    serviceDiscoveryResources: 0,
    loadBalancerResources: 0,
    dependencyEdges: 0,
  };

  // Validate directory exists
  if (!fs.existsSync(directory)) {
    return {
      success: false,
      error: `目錄不存在: ${directory}`,
      directory,
      files: [],
      resources: [],
      summary: emptySummary,
    };
  }

  const stats = fs.statSync(directory);
  if (!stats.isDirectory()) {
    return {
      success: false,
      error: `路徑不是目錄: ${directory}`,
      directory,
      files: [],
      resources: [],
      summary: emptySummary,
    };
  }

  // Step 1: Use Plugin Registry for detection
  const detectedPlugins = await globalRegistry.detectPlugins(directory);
  const detectedTypes = new Set<IacType>();
  const pluginFiles: IacFileInfo[] = [];

  for (const { detection } of detectedPlugins) {
    detectedTypes.add(detection.iacType);

    // Collect files from plugin metadata
    if (detection.metadata?.detectedFiles) {
      for (const filePath of detection.metadata.detectedFiles) {
        // Avoid duplicates
        if (!pluginFiles.some((f) => f.path === filePath)) {
          pluginFiles.push({
            path: filePath,
            relativePath: path.relative(directory, filePath),
            type: detection.iacType,
            fileName: path.basename(filePath),
          });
        }
      }
    }
  }

  // Step 2: Fallback file discovery for comprehensive scanning
  // (Plugins might not return all files, and we need to scan for resources in all files)
  const discoveredFiles = discoverIacFiles(directory);

  // Merge files, preferring plugin-detected types
  const fileMap = new Map<string, IacFileInfo>();

  // Add plugin files first (higher confidence)
  for (const file of pluginFiles) {
    fileMap.set(file.path, file);
  }

  // Add discovered files (only if not already present)
  for (const file of discoveredFiles) {
    if (!fileMap.has(file.path)) {
      fileMap.set(file.path, file);
    }
  }

  const files = Array.from(fileMap.values());
  const resources: IacResourceDefinition[] = [];

  // Step 3: Process each file for resource extraction
  for (const file of files) {
    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const isTerraform = file.type === 'terraform' || file.type === 'terragrunt';
      const fileResources = extractResources(content, file.relativePath, isTerraform);

      if (includeSnippets) {
        for (const resource of fileResources) {
          resource.snippet = extractSnippet(content, resource.lineNumber);
        }
      }

      resources.push(...fileResources);
    } catch {
      // Skip files we can't read
    }
  }

  // Step 4: Build dependency graph
  const dependencyGraph = buildDependencyEdges(resources);

  // Step 5: Build summary
  const serverlessCount = files.filter((f) => f.type === 'serverless').length;
  const summary = {
    totalFiles: files.length,
    terraform: files.filter((f) => f.type === 'terraform').length,
    terragrunt: files.filter((f) => f.type === 'terragrunt').length,
    cloudformation: files.filter((f) => f.type === 'cloudformation').length,
    ...(serverlessCount > 0 && { serverless: serverlessCount }),
    ecsResources: resources.filter((r) => r.type === 'ecs').length,
    rdsResources: resources.filter((r) => r.type === 'rds').length,
    autoscalingResources: resources.filter((r) => r.type === 'autoscaling').length,
    securityGroupResources: resources.filter((r) => r.type === 'security_group').length,
    serviceDiscoveryResources: resources.filter((r) => r.type === 'service_discovery').length,
    loadBalancerResources: resources.filter((r) => r.type === 'load_balancer').length,
    dependencyEdges: dependencyGraph.length,
  };

  return {
    success: true,
    directory,
    files,
    resources,
    summary,
    dependencyGraph: dependencyGraph.length > 0 ? dependencyGraph : undefined,
  };
}
