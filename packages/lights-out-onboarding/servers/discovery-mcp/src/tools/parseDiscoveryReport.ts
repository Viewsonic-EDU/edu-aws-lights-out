/**
 * Parse Discovery Report Tool
 *
 * Parses a discovery report markdown file and extracts resource information,
 * classifying resources into autoApply, needConfirmation, and excluded categories.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ParseDiscoveryReportInput,
  ParseDiscoveryReportResult,
  ParsedEcsResource,
  ParsedRdsResource,
  LightsOutTags,
  RiskLevel,
  ResourceClassification,
} from '../types.js';

/**
 * Extract AWS account ID from report content or file path
 */
function extractAccountId(content: string, reportPath: string): string {
  // Try to extract from content
  const accountMatch = content.match(/\*\*AWS 帳號：\*\*\s*(\d{12})/);
  if (accountMatch) {
    return accountMatch[1];
  }

  // Fall back to directory name
  const dirName = path.basename(path.dirname(reportPath));
  if (/^\d{12}$/.test(dirName)) {
    return dirName;
  }

  return 'unknown';
}

/**
 * Extract regions from report content
 */
function extractRegions(content: string): string[] {
  const regionMatch = content.match(/\*\*探索區域：\*\*\s*(.+)/);
  if (regionMatch) {
    return regionMatch[1].split(',').map((r) => r.trim());
  }
  return [];
}

/**
 * Extract common prefix from an array of service names
 * Example: ['vs-auth-dev', 'vs-admin-auth-dev', 'vs-account-dev'] => 'vs-account'
 */
function extractCommonPrefix(names: string[]): string {
  if (names.length === 0) return 'unknown';
  if (names.length === 1) {
    // For single name, extract prefix before last hyphen segment
    const parts = names[0].split('-');
    if (parts.length >= 2) {
      // Remove the last segment (usually env like 'dev', 'staging')
      return parts.slice(0, -1).join('-');
    }
    return names[0];
  }

  // Find common prefix by comparing characters
  const sortedNames = [...names].sort();
  const first = sortedNames[0];
  const last = sortedNames[sortedNames.length - 1];

  let commonLength = 0;
  for (let i = 0; i < first.length && i < last.length; i++) {
    if (first[i] === last[i]) {
      commonLength = i + 1;
    } else {
      break;
    }
  }

  let prefix = first.substring(0, commonLength);

  // Clean up prefix: remove trailing hyphen
  if (prefix.endsWith('-')) {
    prefix = prefix.slice(0, -1);
  }

  // If prefix is too short or empty, try to find a meaningful prefix
  if (prefix.length < 3) {
    // Extract first two segments from first name
    const parts = first.split('-');
    if (parts.length >= 2) {
      prefix = parts.slice(0, 2).join('-');
    } else {
      prefix = first;
    }
  }

  return prefix || 'unknown';
}

/**
 * Parse ECS services table from report
 */
function parseEcsTable(
  content: string,
  accountId: string,
  projectName: string
): ParsedEcsResource[] {
  const resources: ParsedEcsResource[] = [];

  // Find ECS Services section
  const ecsSection = content.match(
    /## ECS Services\n\n([\s\S]*?)(?=\n##|\n---|\n### 高風險服務說明|$)/
  );
  if (!ecsSection) return resources;

  // Parse table rows
  const tableContent = ecsSection[1];
  const rows = tableContent
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.includes('---'));

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c);

    if (cells.length < 7) continue;

    const [region, cluster, serviceName, statusStr, autoScalingStr, riskLevelStr, supportStr] =
      cells;

    // Parse status (e.g., "1/1" -> { desired: 1, running: 1 })
    const statusMatch = statusStr.match(/(\d+)\/(\d+)/);
    const status = statusMatch ? `${statusMatch[1]}/${statusMatch[2]}` : statusStr;

    // Parse auto scaling
    const hasAutoScaling = autoScalingStr.includes('✅');
    const autoScalingRange = autoScalingStr.match(/\((\d+-\d+)\)/)?.[1];

    // Parse risk level
    const riskLevel: RiskLevel = riskLevelStr.includes('high')
      ? 'high'
      : riskLevelStr.includes('medium')
        ? 'medium'
        : 'low';

    // Parse lights out support
    const lightsOutSupport: 'supported' | 'caution' | 'not-supported' = supportStr.includes(
      'supported'
    )
      ? 'supported'
      : supportStr.includes('caution')
        ? 'caution'
        : 'not-supported';

    // Determine classification
    let classification: ResourceClassification;
    let classificationReason: string;

    if (lightsOutSupport === 'not-supported') {
      classification = 'excluded';
      classificationReason = 'Resource type not supported by Lights Out';
    } else if (riskLevel === 'high' || lightsOutSupport === 'caution') {
      classification = 'needConfirmation';
      classificationReason =
        riskLevel === 'high'
          ? 'High risk service (scheduler/webhook role) - requires confirmation'
          : 'Service requires caution - please review before applying';
    } else {
      classification = 'autoApply';
      classificationReason = 'Low risk service with full Lights Out support';
    }

    // Generate ARN
    const arn = `arn:aws:ecs:${region}:${accountId}:service/${cluster}/${serviceName}`;

    // Suggest tags based on risk level
    const suggestedTags: LightsOutTags = {
      'lights-out:managed': 'true',
      'lights-out:project': projectName,
      'lights-out:priority': riskLevel === 'high' ? '100' : '50',
    };

    resources.push({
      region,
      cluster,
      serviceName,
      arn,
      status,
      hasAutoScaling,
      autoScalingRange,
      riskLevel,
      lightsOutSupport,
      classification,
      classificationReason,
      suggestedTags,
    });
  }

  return resources;
}

/**
 * Parse RDS instances table from report
 */
function parseRdsTable(
  content: string,
  accountId: string,
  projectName: string
): ParsedRdsResource[] {
  const resources: ParsedRdsResource[] = [];

  // Find RDS Instances section
  const rdsSection = content.match(
    /## RDS Instances\n\n([\s\S]*?)(?=\n##|\n---|\n### 不支援的實例說明|$)/
  );
  if (!rdsSection) return resources;

  // Parse table rows
  const tableContent = rdsSection[1];
  const rows = tableContent
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.includes('---'));

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c);

    if (cells.length < 6) continue;

    const [region, instanceId, engineStr, status, instanceType, supportStr] = cells;

    // Parse lights out support
    const lightsOutSupport: 'supported' | 'cluster-managed' | 'not-supported' = supportStr.includes(
      'supported'
    )
      ? 'supported'
      : supportStr.includes('cluster-managed')
        ? 'cluster-managed'
        : 'not-supported';

    // Determine classification
    let classification: ResourceClassification;
    let classificationReason: string;

    if (lightsOutSupport === 'supported') {
      classification = 'autoApply';
      classificationReason = 'Standard RDS instance with full Lights Out support';
    } else if (lightsOutSupport === 'cluster-managed') {
      classification = 'excluded';
      classificationReason =
        'Aurora cluster member - must be managed via cluster (not yet supported)';
    } else {
      classification = 'excluded';
      classificationReason = 'RDS type not supported (e.g., read replica)';
    }

    // Generate ARN
    const arn = `arn:aws:rds:${region}:${accountId}:db:${instanceId}`;

    // Suggest tags only for supported instances
    let suggestedTags: LightsOutTags | undefined;
    if (lightsOutSupport === 'supported') {
      suggestedTags = {
        'lights-out:managed': 'true',
        'lights-out:project': projectName,
        'lights-out:priority': '100', // RDS should start first, stop last
      };
    }

    resources.push({
      region,
      instanceId,
      arn,
      engine: engineStr,
      status,
      instanceType,
      lightsOutSupport,
      classification,
      classificationReason,
      suggestedTags,
    });
  }

  return resources;
}

/**
 * Parses a discovery report markdown file.
 *
 * @param input - Input parameters
 * @returns Parsed resources with classification
 */
export async function parseDiscoveryReport(
  input: ParseDiscoveryReportInput
): Promise<ParseDiscoveryReportResult> {
  const { reportPath } = input;

  try {
    // Check if file exists
    if (!fs.existsSync(reportPath)) {
      return {
        success: false,
        error: `Report file not found: ${reportPath}`,
        reportPath,
        accountId: 'unknown',
        regions: [],
        detectedProject: 'unknown',
        ecsResources: [],
        rdsResources: [],
        summary: {
          totalEcs: 0,
          totalRds: 0,
          autoApply: 0,
          needConfirmation: 0,
          excluded: 0,
        },
        categorized: {
          autoApply: [],
          needConfirmation: [],
          excluded: [],
        },
      };
    }

    // Read report content
    const content = fs.readFileSync(reportPath, 'utf-8');

    // Extract metadata
    const accountId = extractAccountId(content, reportPath);
    const regions = extractRegions(content);

    // First pass: extract service names to find common prefix
    const ecsSection = content.match(
      /## ECS Services\n\n([\s\S]*?)(?=\n##|\n---|\n### 高風險服務說明|$)/
    );
    const serviceNames: string[] = [];
    if (ecsSection) {
      const tableContent = ecsSection[1];
      const rows = tableContent
        .split('\n')
        .filter((line) => line.startsWith('|') && !line.includes('---'));
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i]
          .split('|')
          .map((c) => c.trim())
          .filter((c) => c);
        if (cells.length >= 3) {
          serviceNames.push(cells[2]); // serviceName is the 3rd column
        }
      }
    }

    // Extract common prefix for project name
    const detectedProject = extractCommonPrefix(serviceNames);

    // Parse resources with project name
    const ecsResources = parseEcsTable(content, accountId, detectedProject);
    const rdsResources = parseRdsTable(content, accountId, detectedProject);

    // Categorize resources
    const allResources = [...ecsResources, ...rdsResources];
    const categorized = {
      autoApply: allResources.filter((r) => r.classification === 'autoApply'),
      needConfirmation: allResources.filter((r) => r.classification === 'needConfirmation'),
      excluded: allResources.filter((r) => r.classification === 'excluded'),
    };

    return {
      success: true,
      reportPath,
      accountId,
      regions,
      detectedProject,
      ecsResources,
      rdsResources,
      summary: {
        totalEcs: ecsResources.length,
        totalRds: rdsResources.length,
        autoApply: categorized.autoApply.length,
        needConfirmation: categorized.needConfirmation.length,
        excluded: categorized.excluded.length,
      },
      categorized,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to parse report: ${errorMessage}`,
      reportPath,
      accountId: 'unknown',
      regions: [],
      detectedProject: 'unknown',
      ecsResources: [],
      rdsResources: [],
      summary: {
        totalEcs: 0,
        totalRds: 0,
        autoApply: 0,
        needConfirmation: 0,
        excluded: 0,
      },
      categorized: {
        autoApply: [],
        needConfirmation: [],
        excluded: [],
      },
    };
  }
}
