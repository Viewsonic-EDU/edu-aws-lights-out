/**
 * ECS Service Handler implementation.
 *
 * Handles start, stop, and status operations for AWS ECS Services.
 */

import {
  ECSClient,
  DescribeServicesCommand,
  UpdateServiceCommand,
  waitUntilServicesStable,
  type Service,
} from "@aws-sdk/client-ecs";
import type { Logger } from "pino";
import type {
  DiscoveredResource,
  Config,
  HandlerResult,
  ResourceHandler,
  ECSStopBehavior,
} from "@/types";
import { setupLogger } from "@utils/logger";
import { getResourceDefaults } from "@handlers/base";

/**
 * Handler for AWS ECS Service resources.
 *
 * This handler manages the lifecycle of ECS Services by controlling
 * the desiredCount parameter. When stopping, it sets desiredCount to 0.
 * When starting, it uses the default_desired_count from configuration.
 */
export class ECSServiceHandler implements ResourceHandler {
  private ecsClient: ECSClient;
  private clusterName: string;
  private serviceName: string;
  private logger: Logger;

  constructor(private resource: DiscoveredResource, private config: Config) {
    this.logger = setupLogger(`lights-out:handler.${resource.resourceType}`);

    // Extract region from ARN (format: arn:aws:ecs:REGION:account:...)
    // Falls back to AWS_DEFAULT_REGION environment variable if not in ARN
    let region: string | undefined;
    if (resource.arn?.startsWith("arn:aws:")) {
      const arnParts = resource.arn.split(":");
      if (arnParts.length >= 4) {
        region = arnParts[3];
      }
    }

    // Initialize ECS client with region
    this.ecsClient = new ECSClient({ region });

    // Extract cluster and service names from resource
    this.clusterName = (resource.metadata.cluster_name as string) ?? "default";

    // Extract service name from resource_id
    // Format can be "cluster/service" or just "service"
    if (resource.resourceId.includes("/")) {
      this.serviceName = resource.resourceId.split("/").pop()!;
    } else {
      this.serviceName = resource.resourceId;
    }
  }

  /**
   * Get current status of the ECS Service.
   *
   * @returns Object with keys:
   *   - desired_count: Target number of tasks
   *   - running_count: Currently running tasks
   *   - status: Service status (e.g., "ACTIVE")
   *   - is_stopped: Boolean indicating if desiredCount is 0
   *
   * @throws Error if service not found or API call fails
   */
  async getStatus(): Promise<Record<string, unknown>> {
    try {
      const response = await this.ecsClient.send(
        new DescribeServicesCommand({
          cluster: this.clusterName,
          services: [this.serviceName],
        })
      );

      if (!response.services || response.services.length === 0) {
        throw new Error(
          `Service ${this.serviceName} not found in cluster ${this.clusterName}`
        );
      }

      const service: Service = response.services[0];
      const desiredCount = service.desiredCount ?? 0;
      const runningCount = service.runningCount ?? 0;
      const status = service.status ?? "UNKNOWN";

      return {
        desired_count: desiredCount,
        running_count: runningCount,
        status,
        is_stopped: desiredCount === 0,
      };
    } catch (error) {
      this.logger.error(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          error,
        },
        `Failed to get status for service ${this.serviceName}`
      );
      throw error;
    }
  }

  /**
   * Stop the ECS Service by setting desiredCount to 0.
   *
   * This operation is idempotent - if the service is already stopped,
   * it returns success without making changes.
   *
   * @returns HandlerResult indicating success or failure
   */
  async stop(): Promise<HandlerResult> {
    try {
      // 1. Get current status
      const currentStatus = await this.getStatus();

      this.logger.info(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          current_desired_count: currentStatus.desired_count,
        },
        "Attempting to stop service"
      );

      // 2. Extract stop behavior from config
      const defaults = getResourceDefaults(
        this.config,
        this.resource.resourceType
      );
      const stopBehavior = (defaults.stopBehavior as ECSStopBehavior) ?? {
        mode: "scale_to_zero" // Default for backward compatibility
      };

      // 3. Calculate target count based on mode
      let targetCount: number;
      switch (stopBehavior.mode) {
        case "scale_to_zero":
          targetCount = 0;
          break;
        case "reduce_by_count":
          targetCount = Math.max(
            0,
            (currentStatus.desired_count as number) - (stopBehavior.reduceByCount ?? 1)
          );
          break;
        case "reduce_to_count":
          targetCount = stopBehavior.reduceToCount ?? 0;
          break;
        default:
          targetCount = 0;
      }

      this.logger.info(
        {
          ssmConfig: defaults,
          cluster: this.clusterName,
          service: this.serviceName,
          current: currentStatus.desired_count,
          target: targetCount,
          mode: stopBehavior.mode,
        },
        "Calculated target count for stop operation"
      );

      // 4. Idempotent check - already at target count
      if (currentStatus.desired_count === targetCount) {
        this.logger.info(
          {
            cluster: this.clusterName,
            service: this.serviceName,
            target: targetCount,
          },
          "Service already at target count"
        );
        return {
          success: true,
          action: "stop",
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service already at target count ${targetCount}`,
          previousState: currentStatus,
        };
      }

      // 5. Update service to target count
      await this.ecsClient.send(
        new UpdateServiceCommand({
          cluster: this.clusterName,
          service: this.serviceName,
          desiredCount: targetCount,
        })
      );

      this.logger.info(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          previous_count: currentStatus.desired_count,
          target_count: targetCount,
        },
        `Updated service desiredCount to ${targetCount}`
      );

      // 6. Wait for stable if configured
      if (defaults.waitForStable) {
        const timeout = (defaults.stableTimeoutSeconds as number) ?? 300;
        this.logger.info(
          {
            cluster: this.clusterName,
            service: this.serviceName,
            timeout,
          },
          `Waiting for service to stabilize (timeout: ${timeout}s)`
        );
        await this.waitForStable(timeout);
      }

      return {
        success: true,
        action: "stop",
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `Service scaled to ${targetCount} (was ${currentStatus.desired_count})`,
        previousState: currentStatus,
      };
    } catch (error) {
      this.logger.error(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          error,
        },
        "Failed to stop service"
      );
      return {
        success: false,
        action: "stop",
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: "Stop operation failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Start the ECS Service by setting desiredCount to default value.
   *
   * Uses default_desired_count from configuration. This operation is
   * idempotent - if the service is already at the desired count, it
   * returns success without making changes.
   *
   * @returns HandlerResult indicating success or failure
   */
  async start(): Promise<HandlerResult> {
    try {
      // 1. Get current status
      const currentStatus = await this.getStatus();

      // 2. Get target desired count from config
      const defaults = getResourceDefaults(
        this.config,
        this.resource.resourceType
      );
      const targetCount = (defaults.defaultDesiredCount as number) ?? 1;

      this.logger.info(
        {
          ssmConfig: defaults,
          cluster: this.clusterName,
          service: this.serviceName,
          current_desired_count: currentStatus.desired_count,
          target_count: targetCount,
        },
        "Attempting to start service"
      );

      // 3. Idempotent check - already at target count
      if (currentStatus.desired_count === targetCount) {
        this.logger.info(
          {
            cluster: this.clusterName,
            service: this.serviceName,
          },
          `Service already at desired count ${targetCount}`
        );
        return {
          success: true,
          action: "start",
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service already at desired count ${targetCount}`,
          previousState: currentStatus,
        };
      }

      // 4. Update service to start
      await this.ecsClient.send(
        new UpdateServiceCommand({
          cluster: this.clusterName,
          service: this.serviceName,
          desiredCount: targetCount,
        })
      );

      this.logger.info(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          previous_count: currentStatus.desired_count,
          target_count: targetCount,
        },
        `Updated service desiredCount to ${targetCount}`
      );

      // 5. Wait for stable if configured
      if (defaults.waitForStable) {
        const timeout = (defaults.stableTimeoutSeconds as number) ?? 300;
        this.logger.info(
          {
            cluster: this.clusterName,
            service: this.serviceName,
            timeout,
          },
          `Waiting for service to stabilize (timeout: ${timeout}s)`
        );
        await this.waitForStable(timeout);
      }

      return {
        success: true,
        action: "start",
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `Service scaled to ${targetCount}`,
        previousState: currentStatus,
      };
    } catch (error) {
      this.logger.error(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          error,
        },
        "Failed to start service"
      );
      return {
        success: false,
        action: "start",
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: "Start operation failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if service has reached its desired state.
   *
   * A service is considered ready when:
   * - desired_count equals running_count
   *
   * @returns True if service is ready, false otherwise
   */
  async isReady(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      const isReady = status.desired_count === status.running_count;

      this.logger.debug(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          desired_count: status.desired_count,
          running_count: status.running_count,
          is_ready: isReady,
        },
        `Service ready check: ${isReady}`
      );

      return isReady;
    } catch (error) {
      this.logger.error(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          error,
        },
        "Failed to check if service is ready"
      );
      return false;
    }
  }

  /**
   * Wait for the ECS Service to reach a stable state.
   *
   * Uses AWS SDK waiter to poll the service status until it becomes stable.
   *
   * @param timeout - Maximum wait time in seconds
   * @throws Error if service does not stabilize within timeout
   */
  private async waitForStable(timeout: number = 300): Promise<void> {
    // Calculate max attempts based on timeout and polling interval
    // Waiter polls every 15 seconds by default
    const pollingInterval = 15;
    const maxAttempts = Math.max(1, Math.floor(timeout / pollingInterval));

    this.logger.debug(
      {
        cluster: this.clusterName,
        service: this.serviceName,
        timeout,
        max_attempts: maxAttempts,
      },
      "Starting waiter for service stability"
    );

    await waitUntilServicesStable(
      {
        client: this.ecsClient,
        maxWaitTime: timeout,
        minDelay: pollingInterval,
        maxDelay: pollingInterval,
      },
      {
        cluster: this.clusterName,
        services: [this.serviceName],
      }
    );

    this.logger.info(
      {
        cluster: this.clusterName,
        service: this.serviceName,
      },
      "Service reached stable state"
    );
  }
}
