/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/**
 * Teams Integration Utilities
 *
 * Provides functions for managing DynamoDB Teams configuration:
 * - setupDatabase: Create DynamoDB table
 * - addProject: Add or update project webhook configuration
 * - listProjects: List all configured projects
 *
 * Note: Table name is fixed as 'lights-out-teams-config' (no stage suffix)
 * Each AWS account has one table, projects are distinguished by partition key
 */

const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const prompts = require('prompts');
const fetch = require('node-fetch');

const TABLE_NAME = 'lights-out-teams-config';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Validate webhook URL format.
 * Supports:
 * - Teams Incoming Webhook: *.webhook.office.com
 * - Azure Logic Apps: *.logic.azure.com
 * - Power Platform Workflows: *.environment.api.powerplatform.com
 */
function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname.endsWith('webhook.office.com') ||
       parsed.hostname.endsWith('logic.azure.com') ||
       parsed.hostname.endsWith('environment.api.powerplatform.com')) &&
      parsed.protocol === 'https:'
    );
  } catch {
    return false;
  }
}

/**
 * Test webhook URL by sending a test card.
 */
async function testWebhook(webhookUrl) {
  const testCard = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: '🧪 Test Notification',
              weight: 'Bolder',
              size: 'Medium',
              color: 'Accent',
            },
            {
              type: 'TextBlock',
              text: 'This is a test message from AWS Lights-Out Teams integration setup.',
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: `Sent at: ${new Date().toISOString()}`,
              size: 'Small',
              color: 'Dark',
              spacing: 'Small',
            },
          ],
        },
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testCard),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log(`\n❌ Webhook test failed: ${response.status} ${response.statusText}`, 'red');
      log(`   Response: ${errorText}`, 'dim');
      return false;
    }

    return true;
  } catch (error) {
    log(`\n❌ Webhook test failed: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Setup DynamoDB table for Teams configuration.
 *
 * @param {string} region - AWS region
 * @param {object} env - Environment variables with AWS credentials
 */
async function setupDatabase(region, env) {
  log('🔧 Teams Integration - DynamoDB Setup\n', 'bright');

  log(`📋 Configuration:`, 'cyan');
  log(`   Table Name: ${TABLE_NAME}`);
  log(`   Region: ${region}\n`);

  // Confirm
  const confirmResponse = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: 'Proceed with DynamoDB table creation?',
    initial: true,
  });

  if (!confirmResponse.confirmed) {
    log('\n❌ Setup cancelled', 'red');
    process.exit(0);
  }

  const client = new DynamoDBClient({ region });

  // Check if table already exists
  log(`\n🔍 Checking if table exists...`, 'yellow');

  try {
    const describeCommand = new DescribeTableCommand({ TableName: TABLE_NAME });
    const describeResult = await client.send(describeCommand);

    if (describeResult.Table) {
      log(`\n✅ Table already exists!`, 'green');
      log(`   Status: ${describeResult.Table.TableStatus}`);
      log(`   ARN: ${describeResult.Table.TableArn}`);
      log(`   Item Count: ${describeResult.Table.ItemCount || 0}\n`);
      return;
    }
  } catch (error) {
    if (error.name !== 'ResourceNotFoundException') {
      throw error;
    }
    // Table doesn't exist, continue to create
  }

  // Create table
  log(`\n🚀 Creating DynamoDB table...`, 'yellow');

  const createCommand = new CreateTableCommand({
    TableName: TABLE_NAME,
    AttributeDefinitions: [
      {
        AttributeName: 'project',
        AttributeType: 'S',
      },
    ],
    KeySchema: [
      {
        AttributeName: 'project',
        KeyType: 'HASH',
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    SSESpecification: {
      Enabled: true,
      SSEType: 'KMS',
    },
    PointInTimeRecoverySpecification: {
      PointInTimeRecoveryEnabled: true,
    },
    Tags: [
      { Key: 'project', Value: 'lights-out' },
      { Key: 'managed-by', Value: 'script' },
      { Key: 'component', Value: 'teams-integration' },
    ],
  });

  try {
    const result = await client.send(createCommand);

    log(`\n✅ Table created successfully!`, 'green');
    log(`   ARN: ${result.TableDescription.TableArn}`);
    log(`   Status: ${result.TableDescription.TableStatus}`);
    log(`\n💡 Note: Table may take a few seconds to become ACTIVE\n`);

    // Wait for table to become active
    log(`⏳ Waiting for table to become ACTIVE...`, 'yellow');

    let isActive = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!isActive && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const describeCommand = new DescribeTableCommand({ TableName: TABLE_NAME });
      const describeResult = await client.send(describeCommand);

      if (describeResult.Table.TableStatus === 'ACTIVE') {
        isActive = true;
        log(`\n✅ Table is now ACTIVE!`, 'green');
      } else {
        attempts++;
        process.stdout.write('.');
      }
    }

    if (!isActive) {
      log(`\n⚠️  Table creation in progress (may take a few more seconds)`, 'yellow');
    }

    log(`\n📝 Next steps:`, 'cyan');
    log(`   Add project configuration:`);
    log(`      npm run teams -- add-project\n`);
  } catch (error) {
    log(`\n❌ Failed to create table: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Add or update project webhook configuration.
 *
 * @param {string} region - AWS region
 * @param {object} env - Environment variables with AWS credentials
 */
async function addProject(region, env) {
  log('➕ Teams Integration - Add Project Configuration\n', 'bright');

  const client = new DynamoDBClient({ region });
  const docClient = DynamoDBDocumentClient.from(client);

  // Check if table exists
  log(`🔍 Checking if table exists...`, 'yellow');

  try {
    const describeCommand = new DescribeTableCommand({ TableName: TABLE_NAME });
    const describeResult = await client.send(describeCommand);

    if (describeResult.Table.TableStatus !== 'ACTIVE') {
      log(`\n❌ Table exists but is not ACTIVE (status: ${describeResult.Table.TableStatus})`, 'red');
      log(`   Please wait for table to become ACTIVE and try again.`, 'yellow');
      process.exit(1);
    }

    log(`✅ Table found: ${TABLE_NAME}\n`, 'green');
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      log(`\n❌ Table not found: ${TABLE_NAME}`, 'red');
      log(`   Please run: npm run teams -- setup-db`, 'yellow');
      process.exit(1);
    }
    throw error;
  }

  // Prompt for project details
  log(`📝 Project Configuration`, 'cyan');

  const projectResponse = await prompts({
    type: 'text',
    name: 'project',
    message: 'Enter project name (e.g., airsync-dev, pg-workshop):',
    validate: (value) => {
      if (!value) return 'Project name is required';
      if (!/^[a-z0-9-]+$/.test(value)) return 'Project name must only contain lowercase letters, numbers, and hyphens';
      return true;
    },
  });

  if (!projectResponse.project) {
    log('\n❌ Setup cancelled', 'red');
    process.exit(0);
  }

  const project = projectResponse.project;

  // Check if project already exists
  try {
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { project },
    });

    const existingItem = await docClient.send(getCommand);

    if (existingItem.Item) {
      log(`\n⚠️  Project "${project}" already exists in table!`, 'yellow');
      log(`   Current webhook: ${existingItem.Item.webhook_url.substring(0, 50)}...`, 'dim');

      const overwriteResponse = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: 'Do you want to overwrite it?',
        initial: false,
      });

      if (!overwriteResponse.confirmed) {
        log('\n❌ Setup cancelled', 'red');
        process.exit(0);
      }
    }
  } catch (error) {
    // Ignore errors (item doesn't exist)
  }

  // Prompt for webhook URL
  const webhookResponse = await prompts({
    type: 'text',
    name: 'webhookUrl',
    message: 'Enter Teams Workflow webhook URL:',
    validate: (value) => {
      if (!value) return 'Webhook URL is required';
      if (!isValidWebhookUrl(value)) {
        return 'Invalid webhook URL. Must be one of:\n' +
               '  - https://xxx.webhook.office.com/...\n' +
               '  - https://prod-xxx.logic.azure.com/...\n' +
               '  - https://xxx.environment.api.powerplatform.com/...';
      }
      return true;
    },
  });

  if (!webhookResponse.webhookUrl) {
    log('\n❌ Setup cancelled', 'red');
    process.exit(0);
  }

  const webhookUrl = webhookResponse.webhookUrl;

  // Ask if user wants to test webhook
  const testResponse = await prompts({
    type: 'confirm',
    name: 'test',
    message: 'Test webhook URL before saving?',
    initial: true,
  });

  if (testResponse.test) {
    log(`\n🧪 Testing webhook...`, 'yellow');

    const testResult = await testWebhook(webhookUrl);

    if (!testResult) {
      const continueResponse = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: 'Webhook test failed. Continue anyway?',
        initial: false,
      });

      if (!continueResponse.confirmed) {
        log('\n❌ Setup cancelled', 'red');
        process.exit(0);
      }
    } else {
      log(`✅ Webhook test succeeded! Check your Teams channel for the test message.`, 'green');
    }
  }

  // Optional: description
  const descriptionResponse = await prompts({
    type: 'text',
    name: 'description',
    message: 'Enter optional description (press Enter to skip):',
    initial: '',
  });

  const description = descriptionResponse.description || `${project} project Teams notifications`;

  // Show configuration summary
  log(`\n📋 Configuration Summary:`, 'cyan');
  log(`   Table Name: ${TABLE_NAME}`);
  log(`   Project: ${project}`);
  log(`   Webhook: ${webhookUrl.substring(0, 50)}...`);
  log(`   Description: ${description}`);
  log(`   Region: ${region}\n`);

  // Confirm
  const confirmResponse = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: 'Save this configuration to DynamoDB?',
    initial: true,
  });

  if (!confirmResponse.confirmed) {
    log('\n❌ Setup cancelled', 'red');
    process.exit(0);
  }

  // Save to DynamoDB
  log(`\n💾 Saving configuration...`, 'yellow');

  const now = new Date().toISOString();

  const putCommand = new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      project,
      webhook_url: webhookUrl,
      description,
      created_at: now,
      updated_at: now,
    },
  });

  try {
    await docClient.send(putCommand);

    log(`\n✅ Configuration saved successfully!`, 'green');
    log(`\n📝 Next steps:`, 'cyan');
    log(`   1. Tag your AWS resources with:`);
    log(`      lights-out:group=${project}  OR`);
    log(`      lights-out:env=${project}    OR`);
    log(`      lights-out:project=${project}`);
    log(``);
    log(`   2. Deploy the Lambda function:`);
    log(`      npm run deploy`);
    log(``);
    log(`   3. Test by manually starting/stopping a resource`);
    log(`      and checking your Teams channel for notifications.`);
    log(``);
  } catch (error) {
    log(`\n❌ Failed to save configuration: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * List all project configurations.
 *
 * @param {string} region - AWS region
 * @param {object} env - Environment variables with AWS credentials
 */
async function listProjects(region, env) {
  log('📋 Teams Integration - List Project Configurations\n', 'bright');

  log(`🔍 Fetching configurations from: ${TABLE_NAME}`, 'cyan');
  log(`   Region: ${region}\n`);

  const client = new DynamoDBClient({ region });
  const docClient = DynamoDBDocumentClient.from(client);

  // Check if table exists
  try {
    const describeCommand = new DescribeTableCommand({ TableName: TABLE_NAME });
    const describeResult = await client.send(describeCommand);

    if (describeResult.Table.TableStatus !== 'ACTIVE') {
      log(`\n❌ Table exists but is not ACTIVE (status: ${describeResult.Table.TableStatus})`, 'red');
      log(`   Please wait for table to become ACTIVE and try again.`, 'yellow');
      process.exit(1);
    }
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      log(`\n❌ Table not found: ${TABLE_NAME}`, 'red');
      log(`   Please run: npm run teams -- setup-db`, 'yellow');
      process.exit(1);
    }
    throw error;
  }

  // Scan table for all items
  try {
    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
    });

    const result = await docClient.send(scanCommand);

    if (!result.Items || result.Items.length === 0) {
      log(`\n📭 No project configurations found.`, 'yellow');
      log(`\n💡 To add a project, run: npm run teams -- add-project\n`);
      return;
    }

    // Sort by project name
    const items = result.Items.sort((a, b) => a.project.localeCompare(b.project));

    log(`✅ Found ${items.length} project configuration(s):\n`, 'green');

    // Display each item
    items.forEach((item, index) => {
      log(`${index + 1}. ${item.project}`, 'bright');
      log(`   Webhook: ${item.webhook_url.substring(0, 60)}...`, 'dim');
      if (item.description) {
        log(`   Description: ${item.description}`, 'dim');
      }
      if (item.created_at) {
        log(`   Created: ${new Date(item.created_at).toLocaleString()}`, 'dim');
      }
      if (item.updated_at && item.updated_at !== item.created_at) {
        log(`   Updated: ${new Date(item.updated_at).toLocaleString()}`, 'dim');
      }
      log('');
    });

    log(`📊 Summary:`, 'cyan');
    log(`   Total projects: ${items.length}`);
    log(`   Table: ${TABLE_NAME}`);
    log(`   Item count: ${result.Count}`);
    log('');
  } catch (error) {
    log(`\n❌ Failed to scan table: ${error.message}`, 'red');
    throw error;
  }
}

module.exports = {
  setupDatabase,
  addProject,
  listProjects,
};
