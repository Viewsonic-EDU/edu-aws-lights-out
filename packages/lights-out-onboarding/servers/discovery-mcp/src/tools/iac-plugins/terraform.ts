/**
 * Terraform IaC Plugin
 *
 * Handles detection and tag patch generation for Terraform (.tf) files.
 */

import type {
  IacDetectionResult,
  IacResourceMatch,
  IacTagPatch,
  LightsOutTags,
} from '../../types.js';
import { BaseIacPlugin } from './base.js';

export class TerraformPlugin extends BaseIacPlugin {
  readonly name = 'terraform';
  readonly iacType = 'terraform' as const;

  async detect(directory: string): Promise<IacDetectionResult> {
    const tfFiles = this.scanDirectory(directory, { extensions: ['.tf'] });

    if (tfFiles.length === 0) {
      return {
        detected: false,
        confidence: 'low',
        iacType: this.iacType,
      };
    }

    // Check if any .tf file contains AWS resources
    let hasAwsResources = false;
    for (const file of tfFiles.slice(0, 10)) {
      // Check first 10 files
      const content = this.readFile(file);
      if (content && (content.includes('aws_ecs_service') || content.includes('aws_db_instance'))) {
        hasAwsResources = true;
        break;
      }
    }

    return {
      detected: true,
      confidence: hasAwsResources ? 'high' : 'medium',
      iacType: this.iacType,
      metadata: {
        detectedFiles: tfFiles.slice(0, 20),
      },
    };
  }

  async findResource(
    directory: string,
    resourceArn: string,
    resourceType: 'ecs-service' | 'rds-db'
  ): Promise<IacResourceMatch | null> {
    const resourceName =
      resourceType === 'ecs-service'
        ? this.extractServiceNameFromEcsArn(resourceArn)
        : this.extractInstanceIdFromRdsArn(resourceArn);

    const tfFiles = this.scanDirectory(directory, { extensions: ['.tf'] });

    for (const file of tfFiles) {
      const content = this.readFile(file);
      if (!content) continue;

      const match =
        resourceType === 'ecs-service'
          ? this.findEcsServiceResource(content, resourceName)
          : this.findRdsInstanceResource(content, resourceName);

      if (match) {
        return {
          filePath: file,
          lineNumber: match.lineNumber,
          resourceIdentifier: match.resourceName,
          context: this.extractContext(content, match.lineNumber),
          endLineNumber: match.endLineNumber,
        };
      }
    }

    return null;
  }

  generatePatch(match: IacResourceMatch, tags: LightsOutTags): IacTagPatch {
    const tagsSnippet = this.generateTagsSnippet(tags);
    const relativePath = match.filePath.split('/').slice(-3).join('/');

    return {
      filePath: match.filePath,
      iacType: this.iacType,
      resourceIdentifier: match.resourceIdentifier,
      suggestedTags: tags,
      lineNumber: match.lineNumber,
      patchSnippet: tagsSnippet,
      instructions: `在 ${relativePath} 的 resource "${match.resourceIdentifier}" (第 ${match.lineNumber} 行) 中加入以下 tags block：

${tagsSnippet}

將此 block 放在 resource block 的結尾，closing brace 之前。`,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private findEcsServiceResource(
    content: string,
    serviceName: string
  ): { lineNumber: number; resourceName: string; endLineNumber?: number } | null {
    const lines = content.split('\n');
    const servicePattern = /resource\s+"aws_ecs_service"\s+"([^"]+)"/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(servicePattern);
      if (match) {
        const resourceName = match[1];
        // Check if this resource references the service name
        const searchRange = lines.slice(i, Math.min(i + 50, lines.length)).join('\n');

        if (
          this.resourceNamesMatch(resourceName, serviceName) ||
          searchRange.includes(`"${serviceName}"`) ||
          searchRange.includes(`= "${serviceName}"`)
        ) {
          // Find end of resource block
          let braceCount = 0;
          let endLine = i;
          for (let j = i; j < lines.length; j++) {
            braceCount += (lines[j].match(/\{/g) || []).length;
            braceCount -= (lines[j].match(/\}/g) || []).length;
            if (braceCount === 0 && j > i) {
              endLine = j;
              break;
            }
          }
          return { lineNumber: i + 1, resourceName, endLineNumber: endLine + 1 };
        }
      }
    }

    return null;
  }

  private findRdsInstanceResource(
    content: string,
    instanceId: string
  ): { lineNumber: number; resourceName: string; endLineNumber?: number } | null {
    const lines = content.split('\n');
    const instancePattern = /resource\s+"aws_db_instance"\s+"([^"]+)"/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(instancePattern);
      if (match) {
        const resourceName = match[1];
        const searchRange = lines.slice(i, Math.min(i + 50, lines.length)).join('\n');

        if (
          this.resourceNamesMatch(resourceName, instanceId) ||
          searchRange.includes(`"${instanceId}"`) ||
          searchRange.includes(`identifier = "${instanceId}"`)
        ) {
          let braceCount = 0;
          let endLine = i;
          for (let j = i; j < lines.length; j++) {
            braceCount += (lines[j].match(/\{/g) || []).length;
            braceCount -= (lines[j].match(/\}/g) || []).length;
            if (braceCount === 0 && j > i) {
              endLine = j;
              break;
            }
          }
          return { lineNumber: i + 1, resourceName, endLineNumber: endLine + 1 };
        }
      }
    }

    return null;
  }

  private generateTagsSnippet(tags: LightsOutTags, indent: string = '  '): string {
    const lines = [
      `${indent}tags = {`,
      `${indent}  "lights-out:managed"  = "${tags['lights-out:managed']}"`,
      `${indent}  "lights-out:project"  = "${tags['lights-out:project']}"`,
      `${indent}  "lights-out:priority" = "${tags['lights-out:priority']}"`,
      `${indent}}`,
    ];
    return lines.join('\n');
  }
}
