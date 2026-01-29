/**
 * IaC Plugin System
 *
 * Exports all plugin-related modules and initializes the global registry
 * with built-in plugins.
 */

// Core exports
export { IacPluginRegistry, globalRegistry } from './registry.js';
export { BaseIacPlugin } from './base.js';

// Plugin exports
export { TerraformPlugin } from './terraform.js';
export { CloudFormationPlugin } from './cloudformation.js';
export { ServerlessPlugin } from './serverless.js';
export { TerragruntPlugin } from './terragrunt.js';

// Initialize global registry with built-in plugins
import { globalRegistry } from './registry.js';
import { TerraformPlugin } from './terraform.js';
import { CloudFormationPlugin } from './cloudformation.js';
import { ServerlessPlugin } from './serverless.js';
import { TerragruntPlugin } from './terragrunt.js';

/**
 * Initialize the global registry with all built-in plugins
 */
export function initializeBuiltInPlugins(): void {
  globalRegistry.register(new TerraformPlugin());
  globalRegistry.register(new CloudFormationPlugin());
  globalRegistry.register(new ServerlessPlugin());
  globalRegistry.register(new TerragruntPlugin());
}

// Auto-initialize on import
initializeBuiltInPlugins();
