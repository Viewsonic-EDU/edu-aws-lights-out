/**
 * Base IaC Plugin
 *
 * Abstract base class providing common utilities for IaC plugins.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  IacPlugin,
  IacDetectionResult,
  IacResourceMatch,
  IacTagPatch,
  IacType,
  LightsOutTags,
} from '../../types.js';

/**
 * Abstract base class for IaC plugins
 */
export abstract class BaseIacPlugin implements IacPlugin {
  abstract readonly name: string;
  abstract readonly iacType: IacType;

  abstract detect(directory: string): Promise<IacDetectionResult>;
  abstract findResource(
    directory: string,
    resourceArn: string,
    resourceType: 'ecs-service' | 'rds-db'
  ): Promise<IacResourceMatch | null>;
  abstract generatePatch(match: IacResourceMatch, tags: LightsOutTags): IacTagPatch;

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Extract service name from ECS ARN
   * arn:aws:ecs:region:account:service/cluster/service-name
   */
  protected extractServiceNameFromEcsArn(arn: string): string {
    const parts = arn.split('/');
    return parts[parts.length - 1] || '';
  }

  /**
   * Extract instance ID from RDS ARN
   * arn:aws:rds:region:account:db:instance-id
   */
  protected extractInstanceIdFromRdsArn(arn: string): string {
    const parts = arn.split(':');
    return parts[parts.length - 1] || '';
  }

  /**
   * Recursively scan a directory for files matching a pattern
   */
  protected scanDirectory(
    directory: string,
    options: {
      extensions?: string[];
      fileNames?: string[];
      excludeDirs?: string[];
      maxDepth?: number;
    } = {}
  ): string[] {
    const {
      extensions = [],
      fileNames = [],
      excludeDirs = ['node_modules', '.git', '.terraform', '.terragrunt-cache', 'dist', 'build'],
      maxDepth = 10,
    } = options;

    const files: string[] = [];

    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            walk(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const matchesExtension =
            extensions.length === 0 || extensions.some((ext) => entry.name.endsWith(ext));
          const matchesFileName = fileNames.length === 0 || fileNames.includes(entry.name);

          if (matchesExtension || matchesFileName) {
            files.push(fullPath);
          }
        }
      }
    };

    walk(directory, 0);
    return files;
  }

  /**
   * Read file content safely
   */
  protected readFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Check if a file exists
   */
  protected fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /**
   * Get relative path from base directory
   */
  protected getRelativePath(filePath: string, baseDir: string): string {
    return path.relative(baseDir, filePath);
  }

  /**
   * Extract context lines around a specific line number
   */
  protected extractContext(content: string, lineNumber: number, contextLines: number = 5): string {
    const lines = content.split('\n');
    const start = Math.max(0, lineNumber - 1 - contextLines);
    const end = Math.min(lines.length, lineNumber + contextLines);
    return lines.slice(start, end).join('\n');
  }

  /**
   * Normalize resource name for matching
   * Removes common suffixes like -dev, -staging, -prod
   */
  protected normalizeResourceName(name: string): string {
    return name.replace(/-(dev|staging|prod|test|qa|demo|poc)$/i, '').toLowerCase();
  }

  /**
   * Check if two resource names match (fuzzy matching)
   */
  protected resourceNamesMatch(name1: string, name2: string): boolean {
    const n1 = this.normalizeResourceName(name1);
    const n2 = this.normalizeResourceName(name2);

    // Exact match
    if (n1 === n2) return true;

    // One contains the other
    if (n1.includes(n2) || n2.includes(n1)) return true;

    // Match without common prefixes (e.g., vs-, aws-)
    const stripPrefix = (s: string) => s.replace(/^(vs-|aws-|my-)/, '');
    if (stripPrefix(n1) === stripPrefix(n2)) return true;

    return false;
  }
}
