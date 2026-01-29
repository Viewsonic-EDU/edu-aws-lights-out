/**
 * Generate IaC Tag Patch Tool
 *
 * Generates Infrastructure as Code (Terraform, CloudFormation, Serverless, Terragrunt)
 * modification suggestions for adding Lights Out tags.
 *
 * Uses a Plugin architecture for extensibility and AI Fallback for unknown IaC structures.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  AiAnalysisContext,
  DirectoryStructure,
  GenerateIacTagPatchInput,
  GenerateIacTagPatchResultWithAiFallback,
  IacTagPatch,
  ResourceToTag,
  SampleFile,
} from '../types.js';
import { globalRegistry } from './iac-plugins/index.js';

// ============================================================================
// AI Fallback Helpers
// ============================================================================

/**
 * Build directory structure tree for AI analysis
 */
function buildDirectoryStructure(
  dir: string,
  maxDepth: number = 4,
  currentDepth: number = 0
): DirectoryStructure {
  const result: DirectoryStructure = {
    path: dir,
    isDirectory: true,
    children: [],
  };

  if (currentDepth >= maxDepth) {
    return result;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip common directories to avoid
      if (
        entry.isDirectory() &&
        [
          'node_modules',
          '.git',
          '.terraform',
          '.terragrunt-cache',
          'dist',
          'build',
          '__pycache__',
        ].includes(entry.name)
      ) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        result.children!.push(buildDirectoryStructure(fullPath, maxDepth, currentDepth + 1));
      } else {
        result.children!.push({
          path: fullPath,
          isDirectory: false,
        });
      }
    }
  } catch {
    // Ignore permission errors
  }

  return result;
}

/**
 * Collect sample files for AI analysis
 */
function collectSampleFiles(
  directory: string,
  maxFiles: number = 10,
  maxContentLength: number = 2000
): SampleFile[] {
  const samples: SampleFile[] = [];
  const relevantExtensions = ['.tf', '.hcl', '.yaml', '.yml', '.json', '.toml'];
  const relevantNames = [
    'terragrunt.hcl',
    'terragrunt.stack.hcl',
    'serverless.yml',
    'serverless.yaml',
    'main.tf',
    'variables.tf',
  ];

  function walk(dir: string) {
    if (samples.length >= maxFiles) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (samples.length >= maxFiles) return;

        const fullPath = path.join(dir, entry.name);

        // Skip common directories
        if (
          entry.isDirectory() &&
          ['node_modules', '.git', '.terraform', '.terragrunt-cache', 'dist', 'build'].includes(
            entry.name
          )
        ) {
          continue;
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const isRelevant = relevantExtensions.includes(ext) || relevantNames.includes(entry.name);

          if (isRelevant) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const truncated = content.length > maxContentLength;

              samples.push({
                relativePath: path.relative(directory, fullPath),
                content: truncated
                  ? content.slice(0, maxContentLength) + '\n... (truncated)'
                  : content,
                truncated,
                fileType: detectFileType(entry.name, content),
              });
            } catch {
              // Ignore read errors
            }
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  walk(directory);
  return samples;
}

/**
 * Detect file type based on name and content
 */
function detectFileType(fileName: string, content: string): string {
  if (fileName.endsWith('.tf')) return 'terraform';
  if (fileName === 'terragrunt.hcl') return 'terragrunt';
  if (fileName === 'terragrunt.stack.hcl') return 'terragrunt-stack';
  if (fileName.endsWith('.hcl')) return 'hcl';
  if (
    fileName.includes('serverless') &&
    (fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
  ) {
    return 'serverless';
  }
  if (content.includes('AWSTemplateFormatVersion') || content.includes('AWS::')) {
    return 'cloudformation';
  }
  if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) return 'yaml';
  if (fileName.endsWith('.json')) return 'json';
  return 'unknown';
}

/**
 * Generate hints for AI analysis based on detected patterns
 */
function generateHints(directory: string, sampleFiles: SampleFile[]): string[] {
  const hints: string[] = [];

  // Check for common patterns
  const hasTerragrunt = sampleFiles.some((f) => f.fileType.includes('terragrunt'));
  const hasTerraform = sampleFiles.some((f) => f.fileType === 'terraform');
  const hasCloudFormation = sampleFiles.some((f) => f.fileType === 'cloudformation');
  const hasServerless = sampleFiles.some((f) => f.fileType === 'serverless');

  if (hasTerragrunt && hasTerraform) {
    hints.push('This appears to be a Terragrunt project with underlying Terraform modules.');
    hints.push(
      'Tags may need to be added at multiple levels: module variables, unit values, or stack configuration.'
    );
  }

  if (hasServerless) {
    hints.push('This uses Serverless Framework. Provider-level tags apply to all resources.');
  }

  if (hasCloudFormation) {
    hints.push(
      'This uses CloudFormation. Tags should be added to the Tags property of each resource.'
    );
  }

  // Check for specific directory patterns
  if (fs.existsSync(path.join(directory, 'module'))) {
    hints.push(
      'Found "module" directory - this may use a shared module pattern where tags are defined as variables.'
    );
  }

  if (fs.existsSync(path.join(directory, 'unit'))) {
    hints.push('Found "unit" directory - this appears to use Terragrunt unit pattern.');
  }

  if (fs.existsSync(path.join(directory, 'stack'))) {
    hints.push('Found "stack" directory - this may use Terragrunt stack pattern.');
  }

  return hints;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generates IaC tag modification suggestions using Plugin architecture.
 * Falls back to AI analysis context when no plugin can handle the IaC structure.
 *
 * @param input - Input parameters
 * @returns IaC patches, instructions, or AI analysis context
 */
export async function generateIacTagPatch(
  input: GenerateIacTagPatchInput
): Promise<GenerateIacTagPatchResultWithAiFallback> {
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
          terragrunt: 0,
          notFound: resources.length,
        },
        notFoundResources: resources.map((r) => r.arn),
      };
    }

    // Try to find a matching plugin
    const pluginResult = await globalRegistry.getBestPlugin(iacDirectory);

    if (!pluginResult) {
      // No plugin matched - prepare AI Fallback context
      const directoryStructure = buildDirectoryStructure(iacDirectory);
      const sampleFiles = collectSampleFiles(iacDirectory);
      const hints = generateHints(iacDirectory, sampleFiles);

      const aiContext: AiAnalysisContext = {
        directoryStructure,
        sampleFiles,
        resources,
        hints,
      };

      return {
        success: true,
        iacDirectory,
        patches: [],
        summary: {
          totalPatches: 0,
          terraform: 0,
          cloudformation: 0,
          serverless: 0,
          terragrunt: 0,
          notFound: resources.length,
        },
        notFoundResources: resources.map((r) => r.arn),
        requiresAiAnalysis: true,
        aiAnalysisContext: aiContext,
      };
    }

    const { plugin, detection } = pluginResult;

    // Use the matched plugin to find and generate patches
    const patches: IacTagPatch[] = [];
    const notFoundResources: string[] = [];
    let terraform = 0;
    let cloudformation = 0;
    let serverless = 0;
    let terragrunt = 0;

    for (const resource of resources) {
      const match = await plugin.findResource(iacDirectory, resource.arn, resource.type);

      if (match) {
        const patch = plugin.generatePatch(match, resource.tags);
        patches.push(patch);

        // Count by IaC type
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
          case 'terragrunt':
            terragrunt++;
            break;
        }
      } else {
        notFoundResources.push(resource.arn);
      }
    }

    // If some resources were not found, check if we should trigger partial AI fallback
    const needsPartialAiFallback =
      notFoundResources.length > 0 && notFoundResources.length < resources.length;

    if (needsPartialAiFallback) {
      // Found some but not all - still provide AI context for unfound resources
      const unfoundResourcesList = resources.filter((r) => notFoundResources.includes(r.arn));
      const directoryStructure = buildDirectoryStructure(iacDirectory);
      const sampleFiles = collectSampleFiles(iacDirectory);
      const hints = generateHints(iacDirectory, sampleFiles);
      hints.push(
        `Plugin "${plugin.name}" (${detection.iacType}) matched but could not find ${notFoundResources.length} resource(s).`
      );

      return {
        success: true,
        iacDirectory,
        patches,
        summary: {
          totalPatches: patches.length,
          terraform,
          cloudformation,
          serverless,
          terragrunt,
          notFound: notFoundResources.length,
        },
        notFoundResources,
        requiresAiAnalysis: true,
        aiAnalysisContext: {
          directoryStructure,
          sampleFiles,
          resources: unfoundResourcesList,
          hints,
        },
      };
    }

    // All resources found (or none found and full AI fallback)
    if (patches.length === 0) {
      // No patches generated - full AI fallback
      const directoryStructure = buildDirectoryStructure(iacDirectory);
      const sampleFiles = collectSampleFiles(iacDirectory);
      const hints = generateHints(iacDirectory, sampleFiles);
      hints.push(
        `Plugin "${plugin.name}" (${detection.iacType}) detected but could not match any resources.`
      );

      return {
        success: true,
        iacDirectory,
        patches: [],
        summary: {
          totalPatches: 0,
          terraform,
          cloudformation,
          serverless,
          terragrunt,
          notFound: resources.length,
        },
        notFoundResources: resources.map((r) => r.arn),
        requiresAiAnalysis: true,
        aiAnalysisContext: {
          directoryStructure,
          sampleFiles,
          resources,
          hints,
        },
      };
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
        terragrunt,
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
        terragrunt: 0,
        notFound: resources.length,
      },
      notFoundResources: resources.map((r) => r.arn),
    };
  }
}
