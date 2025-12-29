#!/usr/bin/env node

/**
 * Deploy Lambda function code directly using AWS SDK
 * This bypasses Serverless Framework's credential issues
 *
 * Usage:
 *   node scripts/deploy-lambda.js \
 *     --function-name "lights-out-dev" \
 *     --region "us-east-1"
 */

const { LambdaClient, UpdateFunctionCodeCommand, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    params[key] = value;
  }

  return params;
}

// Validate required parameters
function validateParams(params) {
  const required = ['function-name', 'region'];
  const missing = required.filter(key => !params[key]);

  if (missing.length > 0) {
    console.error(`❌ Missing required parameters: ${missing.join(', ')}`);
    console.error('\nUsage:');
    console.error('  node scripts/deploy-lambda.js \\');
    console.error('    --function-name "lights-out-dev" \\');
    console.error('    --region "aws-region"');
    process.exit(1);
  }
}

// Build the Lambda package
function buildLambda() {
  console.log('🔨 Building Lambda package...');

  try {
    // Use esbuild to bundle the code
    execSync('npx esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=.build/index.js --external:@aws-sdk/*', {
      stdio: 'inherit'
    });

    console.log('✅ Build completed');
    return true;
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    return false;
  }
}

// Create ZIP file
function createZipFile() {
  console.log('📦 Creating deployment package...');

  try {
    // Create zip file
    execSync('cd .build && zip -r ../deployment.zip . && cd ..', {
      stdio: 'inherit'
    });

    console.log('✅ Deployment package created');
    return true;
  } catch (error) {
    console.error('❌ Failed to create zip:', error.message);
    return false;
  }
}

// Main function
async function main() {
  try {
    const params = parseArgs();
    validateParams(params);

    const { 'function-name': functionName, region } = params;

    console.log(`🚀 Deploying Lambda function: ${functionName}`);
    console.log(`🌍 Region: ${region}\n`);

    // Build Lambda
    if (!buildLambda()) {
      process.exit(1);
    }

    // Create ZIP
    if (!createZipFile()) {
      process.exit(1);
    }

    // Read ZIP file
    const zipBuffer = fs.readFileSync('deployment.zip');

    console.log(`📤 Uploading code (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB)...\n`);

    // Create Lambda client
    const client = new LambdaClient({ region });

    // Check if function exists
    try {
      await client.send(new GetFunctionCommand({ FunctionName: functionName }));
      console.log('✅ Function exists, updating code...');
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        console.error('❌ Function does not exist. Please deploy with Serverless Framework first:');
        console.error(`   serverless deploy --region ${region}`);
        process.exit(1);
      }
      throw error;
    }

    // Update function code
    const command = new UpdateFunctionCodeCommand({
      FunctionName: functionName,
      ZipFile: zipBuffer,
    });

    const startTime = Date.now();
    const response = await client.send(command);
    const duration = Date.now() - startTime;

    console.log('\n✅ Lambda function updated successfully!\n');
    console.log('━'.repeat(80));
    console.log(`📌 Function: ${response.FunctionName}`);
    console.log(`📌 Runtime: ${response.Runtime}`);
    console.log(`📌 Code Size: ${(response.CodeSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📌 Last Modified: ${response.LastModified}`);
    console.log(`📌 Version: ${response.Version}`);
    console.log('━'.repeat(80));
    console.log(`\n⏱️  Upload time: ${duration}ms`);

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    fs.unlinkSync('deployment.zip');
    console.log('✅ Done!');

  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);

    if (error.name === 'ResourceNotFoundException') {
      console.error('\n💡 Hint: Function not found. Deploy with Serverless Framework first.');
    } else if (error.name === 'AccessDeniedException') {
      console.error('\n💡 Hint: Permission denied. Make sure your AWS profile has lambda:UpdateFunctionCode permission.');
    }

    process.exit(1);
  }
}

main();
