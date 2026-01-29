/**
 * Serverless Framework IaC Plugin
 *
 * Handles detection and tag patch generation for Serverless Framework (serverless.yml) files.
 */

import type {
  IacDetectionResult,
  IacResourceMatch,
  IacTagPatch,
  LightsOutTags,
} from '../../types.js';
import { BaseIacPlugin } from './base.js';

export class ServerlessPlugin extends BaseIacPlugin {
  readonly name = 'serverless';
  readonly iacType = 'serverless' as const;

  async detect(directory: string): Promise<IacDetectionResult> {
    const serverlessFiles = this.scanDirectory(directory, {
      fileNames: ['serverless.yml', 'serverless.yaml'],
    });

    if (serverlessFiles.length === 0) {
      return {
        detected: false,
        confidence: 'low',
        iacType: this.iacType,
      };
    }

    // Check if any serverless file has provider section
    let hasProvider = false;
    for (const file of serverlessFiles) {
      const content = this.readFile(file);
      if (content && content.includes('provider:')) {
        hasProvider = true;
        break;
      }
    }

    return {
      detected: true,
      confidence: hasProvider ? 'high' : 'medium',
      iacType: this.iacType,
      metadata: {
        detectedFiles: serverlessFiles,
      },
    };
  }

  async findResource(
    directory: string,
    _resourceArn: string,
    _resourceType: 'ecs-service' | 'rds-db'
  ): Promise<IacResourceMatch | null> {
    // Serverless Framework typically uses provider-level tags
    // We return the provider section location
    const serverlessFiles = this.scanDirectory(directory, {
      fileNames: ['serverless.yml', 'serverless.yaml'],
    });

    for (const file of serverlessFiles) {
      const content = this.readFile(file);
      if (!content) continue;

      const providerMatch = this.findProviderSection(content);
      if (providerMatch) {
        return {
          filePath: file,
          lineNumber: providerMatch.lineNumber,
          resourceIdentifier: 'provider',
          context: this.extractContext(content, providerMatch.lineNumber),
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
      instructions: `在 ${relativePath} 的 provider section (第 ${match.lineNumber} 行) 下加入以下 tags：

${tagsSnippet}

**注意**：Serverless Framework 的 provider-level tags 會套用到所有資源。
如果需要針對特定資源設定不同的 tags，可能需要使用 CloudFormation resources。

範例完整配置：
\`\`\`yaml
provider:
  name: aws
  runtime: nodejs20.x
  ${tagsSnippet.trim()}
\`\`\``,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private findProviderSection(content: string): { lineNumber: number } | null {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (/^provider:\s*$/.test(lines[i]) || /^provider:\s*#/.test(lines[i])) {
        return { lineNumber: i + 1 };
      }
    }

    return null;
  }

  private generateTagsSnippet(tags: LightsOutTags, indent: string = '  '): string {
    const lines = [
      `${indent}tags:`,
      `${indent}  "lights-out:managed": "${tags['lights-out:managed']}"`,
      `${indent}  "lights-out:project": "${tags['lights-out:project']}"`,
      `${indent}  "lights-out:priority": "${tags['lights-out:priority']}"`,
    ];
    return lines.join('\n');
  }
}
