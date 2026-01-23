#!/usr/bin/env node

/**
 * Generate and upload Power Automate API key to AWS SSM Parameter Store.
 *
 * This script generates a cryptographically secure random API key and uploads it
 * to SSM as a SecureString parameter for use by the power-automate-webhook Lambda function.
 *
 * Usage:
 *   node scripts/generate-power-automate-key.js --project <project-name>
 *
 * Example:
 *   node scripts/generate-power-automate-key.js --project airsync-dev
 */

const crypto = require('crypto');
const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
const { parseArgs } = require('./lib/args');

/**
 * Generate a cryptographically secure random API key.
 *
 * @param {number} bytes - Number of random bytes to generate
 * @returns {string} Hex-encoded API key
 */
function generateApiKey(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Upload API key to SSM Parameter Store.
 *
 * @param {string} stage - Deployment stage (e.g., 'airsync-dev', 'production')
 * @param {string} apiKey - API key to upload
 * @param {string} region - AWS region
 * @returns {Promise<void>}
 */
async function uploadApiKey(stage, apiKey, region = 'us-east-1') {
  const parameterName = `/lights-out/${stage}/power-automate-api-key`;

  console.log(`\n📤 Uploading API key to SSM Parameter Store...`);
  console.log(`   Parameter: ${parameterName}`);
  console.log(`   Region: ${region}`);

  const ssmClient = new SSMClient({ region });

  try {
    const command = new PutParameterCommand({
      Name: parameterName,
      Value: apiKey,
      Type: 'SecureString',
      Description: `Power Automate webhook API key for ${stage} environment (generated ${new Date().toISOString()})`,
      Overwrite: true, // Allow updating existing parameter
    });

    await ssmClient.send(command);

    console.log(`✅ API key uploaded successfully!\n`);
  } catch (error) {
    console.error(`\n❌ Failed to upload API key to SSM:`);
    console.error(`   ${error.message}\n`);
    throw error;
  }
}

/**
 * Main function.
 */
async function main() {
  try {
    // Parse command-line arguments
    const params = parseArgs();

    if (!params.project) {
      console.error('\n❌ Error: --project parameter is required\n');
      console.error('Usage: node scripts/generate-power-automate-key.js --project <project-name>\n');
      console.error('Example: node scripts/generate-power-automate-key.js --project airsync-dev\n');
      process.exit(1);
    }

    const stage = params.project;

    console.log('\n🔑 Power Automate API Key Generator');
    console.log('=====================================\n');
    console.log(`Stage: ${stage}`);

    // Generate API key
    console.log('\n🎲 Generating cryptographically secure API key...');
    const apiKey = generateApiKey(32); // 32 bytes = 64 hex characters
    console.log(`✅ API key generated (length: ${apiKey.length} characters)`);

    // Upload to SSM
    await uploadApiKey(stage, apiKey, params.region);

    // Display the API key for user to copy
    console.log('━'.repeat(70));
    console.log('⚠️  IMPORTANT: Save this API key securely!');
    console.log('━'.repeat(70));
    console.log('');
    console.log('API Key:');
    console.log('');
    console.log(`   ${apiKey}`);
    console.log('');
    console.log('━'.repeat(70));
    console.log('');
    console.log('📋 Next Steps:');
    console.log('');
    console.log('1. Copy the API key above');
    console.log('2. Open Power Automate (https://make.powerautomate.com)');
    console.log('3. Edit your /lights-out webhook flow');
    console.log('4. Update the HTTP POST action:');
    console.log('   - Add header: Authorization');
    console.log(`   - Value: Bearer ${apiKey}`);
    console.log('');
    console.log('📖 For detailed setup instructions, see:');
    console.log('   docs/power-automate-setup.md');
    console.log('');
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
