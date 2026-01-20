/**
 * Resource Analysis Tool
 *
 * Analyzes discovered AWS resources and generates recommendations
 * for Lights Out configuration.
 */

import type {
  AnalyzeResourcesInput,
  ResourceAnalysis,
  ResourceRecommendation,
  EcsServiceInfo,
  RdsInstanceInfo,
} from '../types.js';

// Keywords that suggest non-production environments
const DEV_KEYWORDS = ['dev', 'development', 'test', 'staging', 'sandbox', 'qa', 'demo', 'poc'];

// Keywords that suggest production environments
const PROD_KEYWORDS = ['prod', 'production', 'live', 'prd'];

/**
 * Checks if a resource name suggests a development environment.
 */
function isLikelyDevEnvironment(name: string): boolean {
  const lowerName = name.toLowerCase();
  return DEV_KEYWORDS.some((keyword) => lowerName.includes(keyword));
}

/**
 * Checks if a resource name suggests a production environment.
 */
function isLikelyProdEnvironment(name: string): boolean {
  const lowerName = name.toLowerCase();
  return PROD_KEYWORDS.some((keyword) => lowerName.includes(keyword));
}

/**
 * Analyzes an ECS service for Lights Out suitability.
 */
function analyzeEcsService(service: EcsServiceInfo): ResourceRecommendation {
  const resourceId = `${service.clusterName}/${service.serviceName}`;
  const reasons: string[] = [];
  let recommendation: 'recommended' | 'caution' | 'not-recommended' = 'recommended';

  // Check if already tagged
  if (service.hasLightsOutTags) {
    return {
      resourceId,
      resourceType: 'ecs-service',
      recommendation: 'recommended',
      reason: '已配置 lights-out tags',
    };
  }

  // Check for production indicators
  if (
    isLikelyProdEnvironment(service.serviceName) ||
    isLikelyProdEnvironment(service.clusterName)
  ) {
    return {
      resourceId,
      resourceType: 'ecs-service',
      recommendation: 'not-recommended',
      reason: '名稱包含 production 相關關鍵字，建議保持 24/7 運行',
    };
  }

  // Check for dev environment indicators
  if (isLikelyDevEnvironment(service.serviceName) || isLikelyDevEnvironment(service.clusterName)) {
    reasons.push('開發/測試環境');
  }

  // Check service status
  if (service.status !== 'ACTIVE') {
    return {
      resourceId,
      resourceType: 'ecs-service',
      recommendation: 'caution',
      reason: `服務狀態為 ${service.status}，建議先確認服務健康狀態`,
    };
  }

  // Check Task Definition risk level
  if (service.taskDefinition) {
    const td = service.taskDefinition;
    if (td.overallRiskLevel === 'high') {
      recommendation = 'caution';
      reasons.push(`Task Definition 風險等級: 高`);
      reasons.push(...td.riskSummary);
    } else if (td.overallRiskLevel === 'medium') {
      if (recommendation === 'recommended') {
        recommendation = 'caution';
      }
      reasons.push(`Task Definition 風險等級: 中`);
      reasons.push(...td.riskSummary);
    }
  }

  // Build suggested config
  const suggestedConfig: Record<string, unknown> = {
    'lights-out:managed': 'true',
    'lights-out:env': isLikelyDevEnvironment(service.serviceName) ? 'dev' : 'staging',
    'lights-out:priority': '50',
  };

  // Add Task Definition recommendations
  if (service.taskDefinition?.recommendations.length) {
    suggestedConfig.taskDefinitionRecommendations = service.taskDefinition.recommendations;
  }

  // Add Auto Scaling specific notes
  if (service.hasAutoScaling && service.autoScalingConfig) {
    reasons.push(
      `有 Auto Scaling (min: ${service.autoScalingConfig.minCapacity}, max: ${service.autoScalingConfig.maxCapacity})`
    );
    suggestedConfig.start = {
      minCapacity: service.autoScalingConfig.minCapacity,
      maxCapacity: service.autoScalingConfig.maxCapacity,
      desiredCount: service.desiredCount,
    };
    suggestedConfig.stop = {
      minCapacity: 0,
      maxCapacity: 0,
      desiredCount: 0,
    };
  } else {
    suggestedConfig.start = {
      desiredCount: service.desiredCount || 1,
    };
    suggestedConfig.stop = {
      desiredCount: 0,
    };
  }

  if (reasons.length === 0) {
    reasons.push('可安全啟用 lights-out');
  }

  return {
    resourceId,
    resourceType: 'ecs-service',
    recommendation,
    reason: reasons.join('，'),
    suggestedConfig,
  };
}

/**
 * Analyzes an RDS instance for Lights Out suitability.
 */
function analyzeRdsInstance(instance: RdsInstanceInfo): ResourceRecommendation {
  const resourceId = instance.instanceId;
  const reasons: string[] = [];

  // Check if already tagged
  if (instance.hasLightsOutTags) {
    return {
      resourceId,
      resourceType: 'rds-db',
      recommendation: 'recommended',
      reason: '已配置 lights-out tags',
    };
  }

  // Check for production indicators
  if (isLikelyProdEnvironment(instance.instanceId)) {
    return {
      resourceId,
      resourceType: 'rds-db',
      recommendation: 'not-recommended',
      reason: '名稱包含 production 相關關鍵字，建議保持 24/7 運行',
    };
  }

  // Check Multi-AZ - usually indicates production
  if (instance.multiAZ) {
    return {
      resourceId,
      resourceType: 'rds-db',
      recommendation: 'caution',
      reason: 'Multi-AZ 部署通常表示生產環境，請確認是否適合停止',
    };
  }

  // Check instance status
  if (instance.status !== 'available') {
    return {
      resourceId,
      resourceType: 'rds-db',
      recommendation: 'caution',
      reason: `實例狀態為 ${instance.status}，建議先確認實例健康狀態`,
    };
  }

  // Check for dev environment indicators
  if (isLikelyDevEnvironment(instance.instanceId)) {
    reasons.push('開發/測試環境');
  }

  // Build suggested config
  const suggestedConfig: Record<string, unknown> = {
    'lights-out:managed': 'true',
    'lights-out:env': isLikelyDevEnvironment(instance.instanceId) ? 'dev' : 'staging',
    'lights-out:priority': '100', // RDS should be stopped first / started last
  };

  if (reasons.length === 0) {
    reasons.push('可安全啟用 lights-out');
  }

  return {
    resourceId,
    resourceType: 'rds-db',
    recommendation: 'recommended',
    reason: reasons.join('，'),
    suggestedConfig,
  };
}

/**
 * Generates a markdown report from the analysis.
 */
function generateReport(input: AnalyzeResourcesInput, analysis: ResourceAnalysis): string {
  const now = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
  const regions = new Set([
    ...input.resources.ecs.map((s) => s.region),
    ...input.resources.rds.map((i) => i.region),
  ]);

  let report = `# AWS Resource Discovery Report

Generated: ${now}

## Summary
| Metric | Value |
|--------|-------|
| Regions Scanned | ${regions.size} |
| ECS Services | ${input.resources.ecs.length} |
| RDS Instances | ${input.resources.rds.length} |
| Already Tagged | ${analysis.alreadyTagged} |
| Recommended for Lights-Out | ${analysis.recommendedForLightsOut} |

`;

  // ECS Services Table
  if (input.resources.ecs.length > 0) {
    report += `## ECS Services
| Region | Cluster | Service | Running | Auto Scaling | Risk | Lights-Out Ready |
|--------|---------|---------|---------|--------------|------|------------------|
`;
    for (const service of input.resources.ecs) {
      const rec = analysis.recommendations.find(
        (r) => r.resourceId === `${service.clusterName}/${service.serviceName}`
      );
      const status =
        rec?.recommendation === 'recommended'
          ? '✅ Recommended'
          : rec?.recommendation === 'caution'
            ? '⚠️ Caution'
            : '❌ Not Recommended';
      const riskLevel = service.taskDefinition?.overallRiskLevel || 'unknown';
      const riskIcon =
        riskLevel === 'high'
          ? '🔴'
          : riskLevel === 'medium'
            ? '🟡'
            : riskLevel === 'low'
              ? '🟢'
              : '⚪';
      report += `| ${service.region} | ${service.clusterName} | ${service.serviceName} | ${service.runningCount}/${service.desiredCount} | ${service.hasAutoScaling ? 'Yes' : 'No'} | ${riskIcon} ${riskLevel} | ${status} |
`;
    }
    report += '\n';
  }

  // Task Definition Risk Assessment Section
  const servicesWithTaskDef = input.resources.ecs.filter((s) => s.taskDefinition);
  const highRiskServices = servicesWithTaskDef.filter(
    (s) => s.taskDefinition?.overallRiskLevel === 'high'
  );
  const mediumRiskServices = servicesWithTaskDef.filter(
    (s) => s.taskDefinition?.overallRiskLevel === 'medium'
  );

  if (highRiskServices.length > 0 || mediumRiskServices.length > 0) {
    report += `## Task Definition Risk Assessment

`;

    if (highRiskServices.length > 0) {
      report += `### 🔴 High Risk Services

以下服務包含可能在停止時造成問題的容器：

`;
      for (const service of highRiskServices) {
        const td = service.taskDefinition!;
        report += `#### ${service.clusterName}/${service.serviceName}

**Containers:**
| Name | Role | Risk | stopTimeout | Reason |
|------|------|------|-------------|--------|
`;
        for (const container of td.containers) {
          const riskIcon =
            container.riskLevel === 'high' ? '🔴' : container.riskLevel === 'medium' ? '🟡' : '🟢';
          report += `| ${container.name} | ${container.role} | ${riskIcon} ${container.riskLevel} | ${container.stopTimeout ?? 'null'} | ${container.riskReasons[0] || '-'} |
`;
        }

        if (td.recommendations.length > 0) {
          report += `
**建議:**
`;
          for (const rec of td.recommendations) {
            report += `- ${rec}
`;
          }
        }
        report += '\n';
      }
    }

    if (mediumRiskServices.length > 0) {
      report += `### 🟡 Medium Risk Services

`;
      for (const service of mediumRiskServices) {
        const td = service.taskDefinition!;
        report += `#### ${service.clusterName}/${service.serviceName}

**Containers:**
| Name | Role | Risk | stopTimeout |
|------|------|------|-------------|
`;
        for (const container of td.containers) {
          const riskIcon =
            container.riskLevel === 'high' ? '🔴' : container.riskLevel === 'medium' ? '🟡' : '🟢';
          report += `| ${container.name} | ${container.role} | ${riskIcon} ${container.riskLevel} | ${container.stopTimeout ?? 'null'} |
`;
        }

        if (td.recommendations.length > 0) {
          report += `
**建議:**
`;
          for (const rec of td.recommendations) {
            report += `- ${rec}
`;
          }
        }
        report += '\n';
      }
    }
  }

  // RDS Instances Table
  if (input.resources.rds.length > 0) {
    report += `## RDS Instances
| Region | Instance | Engine | Status | Multi-AZ | Lights-Out Ready |
|--------|----------|--------|--------|----------|------------------|
`;
    for (const instance of input.resources.rds) {
      const rec = analysis.recommendations.find((r) => r.resourceId === instance.instanceId);
      const status =
        rec?.recommendation === 'recommended'
          ? '✅ Recommended'
          : rec?.recommendation === 'caution'
            ? '⚠️ Caution'
            : '❌ Not Recommended';
      report += `| ${instance.region} | ${instance.instanceId} | ${instance.engine} ${instance.engineVersion} | ${instance.status} | ${instance.multiAZ ? 'Yes' : 'No'} | ${status} |
`;
    }
    report += '\n';
  }

  // Recommendations
  report += `## Recommendations

`;
  for (const rec of analysis.recommendations) {
    const icon =
      rec.recommendation === 'recommended' ? '✅' : rec.recommendation === 'caution' ? '⚠️' : '❌';
    report += `### ${icon} ${rec.resourceId}

**Type:** ${rec.resourceType}
**Status:** ${rec.reason}

`;
    if (rec.suggestedConfig) {
      report += `**建議 Tags:**
\`\`\`yaml
${Object.entries(rec.suggestedConfig)
  .filter(([k]) => k.startsWith('lights-out:'))
  .map(([k, v]) => `${k}: "${v}"`)
  .join('\n')}
\`\`\`

`;
      const startStop = rec.suggestedConfig.start || rec.suggestedConfig.stop;
      if (startStop) {
        report += `**建議配置:**
\`\`\`yaml
resource_defaults:
  ${rec.resourceType}:
    start:
${Object.entries((rec.suggestedConfig.start as Record<string, unknown>) || {})
  .map(([k, v]) => `      ${k}: ${v}`)
  .join('\n')}
    stop:
${Object.entries((rec.suggestedConfig.stop as Record<string, unknown>) || {})
  .map(([k, v]) => `      ${k}: ${v}`)
  .join('\n')}
\`\`\`

`;
      }
    }
  }

  return report;
}

/**
 * Analyzes discovered resources and generates recommendations.
 *
 * @param input - Discovered resources to analyze
 * @returns Analysis result with recommendations and markdown report
 */
export async function analyzeResources(
  input: AnalyzeResourcesInput
): Promise<{ analysis: ResourceAnalysis; report: string }> {
  const recommendations: ResourceRecommendation[] = [];

  // Analyze ECS services
  for (const service of input.resources.ecs) {
    recommendations.push(analyzeEcsService(service));
  }

  // Analyze RDS instances
  for (const instance of input.resources.rds) {
    recommendations.push(analyzeRdsInstance(instance));
  }

  const analysis: ResourceAnalysis = {
    totalResources: input.resources.ecs.length + input.resources.rds.length,
    alreadyTagged: [
      ...input.resources.ecs.filter((s) => s.hasLightsOutTags),
      ...input.resources.rds.filter((i) => i.hasLightsOutTags),
    ].length,
    recommendedForLightsOut: recommendations.filter((r) => r.recommendation === 'recommended')
      .length,
    recommendations,
  };

  const report = generateReport(input, analysis);

  return { analysis, report };
}
