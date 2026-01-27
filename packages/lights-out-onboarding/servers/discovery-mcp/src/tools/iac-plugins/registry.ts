/**
 * IaC Plugin Registry
 *
 * Central registry for managing IaC plugins. Provides detection and matching
 * capabilities across multiple IaC types.
 */

import type { IacPlugin, IacDetectionResult, IacType } from '../../types.js';

/**
 * Registry for IaC plugins
 */
export class IacPluginRegistry {
  private plugins: Map<string, IacPlugin> = new Map();

  /**
   * Register a plugin
   * @param plugin - The plugin to register
   */
  register(plugin: IacPlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin "${plugin.name}" is already registered. Overwriting.`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Unregister a plugin
   * @param pluginName - Name of the plugin to unregister
   */
  unregister(pluginName: string): boolean {
    return this.plugins.delete(pluginName);
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): IacPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a plugin by name
   */
  getPlugin(name: string): IacPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get plugins by IaC type
   */
  getPluginsByType(iacType: IacType): IacPlugin[] {
    return this.getPlugins().filter((p) => p.iacType === iacType);
  }

  /**
   * Detect which plugin(s) can handle a directory
   * Returns plugins sorted by confidence (high first)
   *
   * @param directory - Path to the IaC directory
   * @returns Array of plugins with their detection results, sorted by confidence
   */
  async detectPlugins(
    directory: string
  ): Promise<Array<{ plugin: IacPlugin; detection: IacDetectionResult }>> {
    const results: Array<{ plugin: IacPlugin; detection: IacDetectionResult }> = [];

    // Run detection for all plugins in parallel
    const detectionPromises = this.getPlugins().map(async (plugin) => {
      try {
        const detection = await plugin.detect(directory);
        return { plugin, detection };
      } catch (error) {
        console.error(`Plugin "${plugin.name}" detection failed:`, error);
        return {
          plugin,
          detection: {
            detected: false,
            confidence: 'low' as const,
            iacType: plugin.iacType,
          },
        };
      }
    });

    const detectionResults = await Promise.all(detectionPromises);

    // Filter to only detected plugins and sort by confidence
    const confidenceOrder = { high: 0, medium: 1, low: 2 };

    for (const result of detectionResults) {
      if (result.detection.detected) {
        results.push(result);
      }
    }

    results.sort(
      (a, b) => confidenceOrder[a.detection.confidence] - confidenceOrder[b.detection.confidence]
    );

    return results;
  }

  /**
   * Get the best matching plugin for a directory
   * Returns the plugin with highest confidence, or null if none detected
   *
   * @param directory - Path to the IaC directory
   * @returns Best matching plugin with detection result, or null
   */
  async getBestPlugin(
    directory: string
  ): Promise<{ plugin: IacPlugin; detection: IacDetectionResult } | null> {
    const results = await this.detectPlugins(directory);

    if (results.length === 0) {
      return null;
    }

    // Return the first (highest confidence) result
    return results[0];
  }
}

/**
 * Global plugin registry instance
 */
export const globalRegistry = new IacPluginRegistry();
