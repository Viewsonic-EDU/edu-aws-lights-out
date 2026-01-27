/**
 * Terragrunt IaC Plugin
 *
 * Handles detection and tag patch generation for Terragrunt (.hcl) files,
 * including support for terragrunt.stack.hcl unit blocks.
 */

import type {
  IacDetectionResult,
  IacResourceMatch,
  IacTagPatch,
  LightsOutTags,
} from '../../types.js';
import { BaseIacPlugin } from './base.js';

export class TerragruntPlugin extends BaseIacPlugin {
  readonly name = 'terragrunt';
  readonly iacType = 'terragrunt' as const;

  async detect(directory: string): Promise<IacDetectionResult> {
    // Look for terragrunt.hcl or terragrunt.stack.hcl files
    const hclFiles = this.scanDirectory(directory, {
      fileNames: ['terragrunt.hcl', 'terragrunt.stack.hcl'],
    });

    if (hclFiles.length === 0) {
      return {
        detected: false,
        confidence: 'low',
        iacType: this.iacType,
      };
    }

    // Check for stack files (higher priority - more structured)
    const stackFiles = hclFiles.filter((f) => f.endsWith('terragrunt.stack.hcl'));
    const hasStackFiles = stackFiles.length > 0;

    // Check if stack files contain unit blocks (ECS services)
    let hasEcsUnits = false;
    for (const file of stackFiles.slice(0, 10)) {
      const content = this.readFile(file);
      if (content && content.includes('unit "') && content.includes('ecs-service')) {
        hasEcsUnits = true;
        break;
      }
    }

    return {
      detected: true,
      confidence: hasEcsUnits ? 'high' : hasStackFiles ? 'medium' : 'low',
      iacType: this.iacType,
      metadata: {
        detectedFiles: hclFiles.slice(0, 20),
        config: {
          hasStackFiles,
          stackFileCount: stackFiles.length,
        },
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

    // Priority 1: Look in terragrunt.stack.hcl files for unit blocks
    const stackFiles = this.scanDirectory(directory, {
      fileNames: ['terragrunt.stack.hcl'],
    });

    for (const file of stackFiles) {
      const content = this.readFile(file);
      if (!content) continue;

      const match = this.findUnitBlock(content, resourceName);
      if (match) {
        return {
          filePath: file,
          lineNumber: match.lineNumber,
          resourceIdentifier: match.unitName,
          context: this.extractContext(content, match.lineNumber, 10),
          endLineNumber: match.endLineNumber,
        };
      }
    }

    // Priority 2: Look in regular terragrunt.hcl files
    const terragruntFiles = this.scanDirectory(directory, {
      fileNames: ['terragrunt.hcl'],
    });

    for (const file of terragruntFiles) {
      const content = this.readFile(file);
      if (!content) continue;

      // Check if this terragrunt.hcl is related to the resource
      if (this.isTerragruntFileForResource(content, file, resourceName)) {
        const inputsMatch = this.findInputsSection(content);
        if (inputsMatch) {
          return {
            filePath: file,
            lineNumber: inputsMatch.lineNumber,
            resourceIdentifier: this.getRelativePath(file, directory),
            context: this.extractContext(content, inputsMatch.lineNumber, 10),
          };
        }
      }
    }

    return null;
  }

  generatePatch(match: IacResourceMatch, tags: LightsOutTags): IacTagPatch {
    const isStackFile = match.filePath.endsWith('terragrunt.stack.hcl');
    const relativePath = match.filePath.split('/').slice(-4).join('/');

    if (isStackFile) {
      return this.generateStackFilePatch(match, tags, relativePath);
    } else {
      return this.generateTerragruntHclPatch(match, tags, relativePath);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private findUnitBlock(
    content: string,
    serviceName: string
  ): { lineNumber: number; unitName: string; endLineNumber: number } | null {
    const lines = content.split('\n');

    // Normalize service name for matching
    const normalizedServiceName = this.normalizeResourceName(serviceName);

    // Look for unit blocks: unit "unit-name" { ... }
    const unitPattern = /^unit\s+"([^"]+)"\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(unitPattern);
      if (match) {
        const unitName = match[1];
        const unitNameNormalized = this.normalizeResourceName(unitName);

        // Check if this unit matches the service name
        if (this.resourceNamesMatch(unitName, serviceName)) {
          // Find the end of this unit block
          let braceCount = 1;
          let endLine = i;
          for (let j = i + 1; j < lines.length && braceCount > 0; j++) {
            const line = lines[j];
            braceCount += (line.match(/\{/g) || []).length;
            braceCount -= (line.match(/\}/g) || []).length;
            if (braceCount === 0) {
              endLine = j;
              break;
            }
          }
          return { lineNumber: i + 1, unitName, endLineNumber: endLine + 1 };
        }

        // Also check the content of the unit block for service name references
        const blockEnd = this.findBlockEnd(lines, i);
        const blockContent = lines.slice(i, blockEnd + 1).join('\n');
        if (
          blockContent.toLowerCase().includes(normalizedServiceName) ||
          blockContent.includes(`"${serviceName}"`)
        ) {
          return { lineNumber: i + 1, unitName, endLineNumber: blockEnd + 1 };
        }
      }
    }

    return null;
  }

  private findBlockEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    for (let i = startLine; i < lines.length; i++) {
      braceCount += (lines[i].match(/\{/g) || []).length;
      braceCount -= (lines[i].match(/\}/g) || []).length;
      if (braceCount === 0 && i > startLine) {
        return i;
      }
    }
    return lines.length - 1;
  }

  private findInputsSection(content: string): { lineNumber: number } | null {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (/^inputs\s*=\s*\{/.test(lines[i]) || lines[i].trim() === 'inputs = {') {
        return { lineNumber: i + 1 };
      }
    }

    return null;
  }

  private isTerragruntFileForResource(
    content: string,
    filePath: string,
    resourceName: string
  ): boolean {
    // Check if the file path contains the resource name
    if (filePath.toLowerCase().includes(this.normalizeResourceName(resourceName))) {
      return true;
    }

    // Check if the content references the resource
    const normalizedName = this.normalizeResourceName(resourceName);
    return content.toLowerCase().includes(normalizedName) || content.includes(`"${resourceName}"`);
  }

  private generateStackFilePatch(
    match: IacResourceMatch,
    tags: LightsOutTags,
    relativePath: string
  ): IacTagPatch {
    const tagsSnippet = this.generateTagsSnippet(tags, '    ');

    const instructions = `在 ${relativePath} 中找到 unit "${match.resourceIdentifier}" (第 ${match.lineNumber} 行)，
在 values = merge(...) 中加入 tags：

\`\`\`hcl
unit "${match.resourceIdentifier}" {
  source = "..."
  values = merge(local.common_dependencies, local.common_unit_values, {
    # ... 其他 values ...
${tagsSnippet}
  })
}
\`\`\`

**重要**：Terragrunt 需要確保底層 Terraform module 支援 tags 變數。

如果 module 尚未支援 tags，需要完成以下步驟：

**1. Module 層級** (例如 module/ecs-service/variable.tf)：
\`\`\`hcl
variable "tags" {
  description = "Tags to apply to the ECS service"
  type        = map(string)
  default     = {}
}
\`\`\`

**2. Module 層級** (例如 module/ecs-service/main.tf 的 aws_ecs_service 資源)：
\`\`\`hcl
resource "aws_ecs_service" "this" {
  # ... 其他配置 ...
  tags = var.tags
}
\`\`\`

**3. Unit 層級** (unit/ecs-service/terragrunt.hcl 的 inputs)：
\`\`\`hcl
inputs = {
  # ... 其他 inputs ...
  tags = try(values.tags, {})
}
\`\`\``;

    return {
      filePath: match.filePath,
      iacType: this.iacType,
      resourceIdentifier: match.resourceIdentifier,
      suggestedTags: tags,
      lineNumber: match.lineNumber,
      patchSnippet: tagsSnippet,
      instructions,
    };
  }

  private generateTerragruntHclPatch(
    match: IacResourceMatch,
    tags: LightsOutTags,
    relativePath: string
  ): IacTagPatch {
    const tagsSnippet = this.generateTagsSnippet(tags, '  ');

    return {
      filePath: match.filePath,
      iacType: this.iacType,
      resourceIdentifier: match.resourceIdentifier,
      suggestedTags: tags,
      lineNumber: match.lineNumber,
      patchSnippet: tagsSnippet,
      instructions: `在 ${relativePath} 的 inputs section (第 ${match.lineNumber} 行) 中加入 tags：

\`\`\`hcl
inputs = {
  # ... 其他 inputs ...
${tagsSnippet}
}
\`\`\`

**注意**：確保對應的 Terraform module 有定義 tags 變數。`,
    };
  }

  private generateTagsSnippet(tags: LightsOutTags, indent: string = '    '): string {
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
