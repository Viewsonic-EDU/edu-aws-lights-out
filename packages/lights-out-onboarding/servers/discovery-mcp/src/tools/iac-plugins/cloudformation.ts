/**
 * CloudFormation IaC Plugin
 *
 * Handles detection and tag patch generation for CloudFormation (.yaml/.yml) files.
 */

import type {
  IacDetectionResult,
  IacResourceMatch,
  IacTagPatch,
  LightsOutTags,
} from '../../types.js';
import { BaseIacPlugin } from './base.js';

export class CloudFormationPlugin extends BaseIacPlugin {
  readonly name = 'cloudformation';
  readonly iacType = 'cloudformation' as const;

  async detect(directory: string): Promise<IacDetectionResult> {
    const yamlFiles = this.scanDirectory(directory, {
      extensions: ['.yaml', '.yml'],
    });

    const cfnFiles: string[] = [];

    for (const file of yamlFiles) {
      // Skip serverless files
      if (file.includes('serverless')) continue;

      const content = this.readFile(file);
      if (content && this.isCloudFormationTemplate(content)) {
        cfnFiles.push(file);
      }
    }

    if (cfnFiles.length === 0) {
      return {
        detected: false,
        confidence: 'low',
        iacType: this.iacType,
      };
    }

    // Check if any template has ECS or RDS resources
    let hasRelevantResources = false;
    for (const file of cfnFiles.slice(0, 10)) {
      const content = this.readFile(file);
      if (
        content &&
        (content.includes('AWS::ECS::Service') || content.includes('AWS::RDS::DBInstance'))
      ) {
        hasRelevantResources = true;
        break;
      }
    }

    return {
      detected: true,
      confidence: hasRelevantResources ? 'high' : 'medium',
      iacType: this.iacType,
      metadata: {
        detectedFiles: cfnFiles.slice(0, 20),
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

    const yamlFiles = this.scanDirectory(directory, {
      extensions: ['.yaml', '.yml'],
    });

    for (const file of yamlFiles) {
      if (file.includes('serverless')) continue;

      const content = this.readFile(file);
      if (!content || !this.isCloudFormationTemplate(content)) continue;

      const cfnType = resourceType === 'ecs-service' ? 'AWS::ECS::Service' : 'AWS::RDS::DBInstance';
      const match = this.findCfnResource(content, resourceName, cfnType);

      if (match) {
        return {
          filePath: file,
          lineNumber: match.lineNumber,
          resourceIdentifier: match.logicalId,
          context: this.extractContext(content, match.lineNumber),
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
      instructions: `在 ${relativePath} 的 resource "${match.resourceIdentifier}" (第 ${match.lineNumber} 行) 的 Properties 下加入以下 Tags：

${tagsSnippet}

CloudFormation Tags 格式為 Key-Value 陣列。`,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private isCloudFormationTemplate(content: string): boolean {
    return content.includes('AWSTemplateFormatVersion') || content.includes('AWS::');
  }

  private findCfnResource(
    content: string,
    resourceName: string,
    resourceType: string
  ): { lineNumber: number; logicalId: string } | null {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      // Look for resource type
      if (lines[i].includes(resourceType)) {
        // Check surrounding lines for the resource name
        const searchRange = lines
          .slice(Math.max(0, i - 15), Math.min(lines.length, i + 30))
          .join('\n');

        if (
          searchRange.toLowerCase().includes(resourceName.toLowerCase()) ||
          this.containsFuzzyMatch(searchRange, resourceName)
        ) {
          // Find the logical ID (the parent key under Resources)
          for (let j = i - 1; j >= 0; j--) {
            // Match patterns like "  ResourceName:" or "  ResourceName:\n"
            const logicalIdMatch = lines[j].match(/^\s{2}(\w+):\s*$/);
            if (logicalIdMatch) {
              return { lineNumber: j + 1, logicalId: logicalIdMatch[1] };
            }
            // Stop if we hit the Resources: key or another top-level key
            if (/^\w+:/.test(lines[j])) {
              break;
            }
          }
        }
      }
    }

    return null;
  }

  private containsFuzzyMatch(content: string, resourceName: string): boolean {
    const normalized = this.normalizeResourceName(resourceName);
    const contentLower = content.toLowerCase();

    // Check various patterns
    return (
      contentLower.includes(normalized) ||
      contentLower.includes(normalized.replace(/-/g, '')) ||
      contentLower.includes(normalized.replace(/-/g, '_'))
    );
  }

  private generateTagsSnippet(tags: LightsOutTags, indent: string = '        '): string {
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
}
