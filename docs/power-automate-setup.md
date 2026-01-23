# Power Automate Integration Setup Guide

This guide walks you through setting up Microsoft Teams integration using Power Automate as an alternative to Teams Outgoing Webhook (which has a platform bug as of 2026-01-22).

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Setup Steps](#setup-steps)
4. [Testing](#testing)
5. [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have:

- ✅ Access to Microsoft Teams
- ✅ Access to Power Automate (usually included with Microsoft 365)
- ✅ Permission to create flows in your organization
- ✅ AWS CLI configured with appropriate credentials
- ✅ Deployed `power-automate-webhook` Lambda function

## Architecture Overview

```
┌──────────────────┐
│ Teams User       │ Posts: "/lights-out start"
│                  │
└────────┬─────────┘
         │
         ▼
┌────────────────────────────────────────┐
│ Power Automate Flow                    │
│                                        │
│ 1. Trigger: When message is posted    │
│ 2. Condition: Starts with /lights-out │
│ 3. Action: HTTP POST to Lambda        │
│ 4. Action: Reply to message           │
└────────┬───────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ AWS Lambda: power-automate-webhook      │
│                                         │
│ 1. Validate API key                    │
│ 2. Check user against whitelist        │
│ 3. Parse command                       │
│ 4. Invoke main handler                 │
│ 5. Return acknowledgment               │
└─────────────────────────────────────────┘
```

## Setup Steps

### Step 1: Generate API Key

1. **Open Terminal** and navigate to the project directory:

   ```bash
   cd /path/to/edu-aws-lights-out
   ```

2. **Run the interactive CLI**:

   ```bash
   npm run config
   ```

3. **Select your project** (e.g., `airsync-dev`)

4. **Select**: `🔐 Generate Power Automate API Key`

5. **Copy the API key** displayed in the output (you'll need it in Step 3)

   Example output:

   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ⚠️  IMPORTANT: Save this API key securely!
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   API Key:

      a1b2c3d4e5f6g7h8i9j0...

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

### Step 2: Deploy Lambda Function

1. **Deploy the Power Automate webhook function**:

   ```bash
   npm run deploy
   ```

2. **Note the API Gateway endpoint URL** from the deployment output:

   ```
   endpoints:
     POST - https://xxxxx.execute-api.us-east-1.amazonaws.com/{stage}/webhook/power-automate
   ```

   Example:

   ```
   https://nopbq6q7mf.execute-api.us-east-1.amazonaws.com/pg-development-airsync-dev/webhook/power-automate
   ```

### Step 3: Create Power Automate Flow

#### 3.1 Access Power Automate

1. **Open** [Power Automate](https://make.powerautomate.com)
2. **Sign in** with your Microsoft account
3. **Select** your environment (usually your organization's name)

#### 3.2 Create New Flow

1. **Click** "+ Create" in the left sidebar
2. **Select** "Automated cloud flow"
3. **Name** your flow: `Lights-Out Teams Bot`
4. **Choose trigger**: Search for "When a new channel message is added"
5. **Click** "Create"

#### 3.3 Configure Trigger

1. **Team**: Select your team (e.g., "Engineering Team")
2. **Channel**: Select the channel to monitor (e.g., "Lights-Out Control")

   > **Tip**: Create a dedicated channel like "lights-out-control" for cleaner operation

#### 3.4 Add Condition (Filter Messages)

1. **Click** "+ New step"
2. **Search** for "Condition"
3. **Configure**:
   - **Choose a value**: Click "Add dynamic content" → Select "Message" → "Body" → "Plain Text Content"
   - **Condition**: "starts with"
   - **Value**: `/lights-out`

   This ensures the flow only triggers for messages starting with `/lights-out`.

#### 3.5 Add HTTP Action (Yes Branch)

1. **In the "If yes" branch**, click "Add an action"
2. **Search** for "HTTP"
3. **Select** "HTTP" action
4. **Configure**:

   | Field       | Value                                                                    |
   | ----------- | ------------------------------------------------------------------------ |
   | **Method**  | POST                                                                     |
   | **URI**     | `https://xxxxx.execute-api.../webhook/power-automate` <br/>(from Step 2) |
   | **Headers** | Add two headers:                                                         |
   |             | Key: `Content-Type`, Value: `application/json`                           |
   |             | Key: `Authorization`, Value: `Bearer <YOUR_API_KEY>` <br/>(from Step 1)  |
   | **Body**    | See JSON body below ↓                                                    |

   **Body JSON**:

   ```json
   {
     "user": "@{triggerBody()?['from']?['user']?['displayName']}",
     "command": "@{triggerBody()?['body']?['plainTextContent']}",
     "messageId": "@{triggerBody()?['id']}",
     "channelId": "@{triggerBody()?['channelIdentity']?['channelId']}",
     "teamId": "@{triggerBody()?['channelIdentity']?['teamId']}"
   }
   ```

   **Visual Example**:

   ```
   URI: https://nopbq6q7mf.execute-api.us-east-1.amazonaws.com/pg-development-airsync-dev/webhook/power-automate

   Headers:
     Content-Type: application/json
     Authorization: Bearer a1b2c3d4e5f6g7h8i9j0...

   Body:
     {
       "user": @{triggerBody()?['from']?['user']?['displayName']},
       "command": @{triggerBody()?['body']?['plainTextContent']},
       ...
     }
   ```

#### 3.6 Add Reply Action (Yes Branch)

1. **Click** "Add an action" (still in "If yes" branch)
2. **Search** for "Reply to a message"
3. **Select** "Reply to a message (V3)" (Microsoft Teams)
4. **Configure**:

   | Field          | Value                               |
   | -------------- | ----------------------------------- |
   | **Reply to**   | Select "Reply to a channel message" |
   | **Team**       | (Auto-populated from trigger)       |
   | **Channel**    | (Auto-populated from trigger)       |
   | **Message**    | (Dynamic content from trigger)      |
   | **Reply with** | `@{body('HTTP')?['message']}`       |

   This will post the Lambda response back to the Teams channel.

#### 3.7 Save and Test

1. **Click** "Save" in the top-right corner
2. **Turn on** the flow (toggle in top-right)

### Step 4: Configure Whitelist (Optional but Recommended)

1. **Edit your SSM config** (e.g., `config/airsync-dev.yml`):

   ```yaml
   notifications:
     teams:
       enabled: true
       webhook_url: https://your-teams-webhook-url
       outgoing_webhook: # Reuse this section for Power Automate
         enabled: true
         allowed_users:
           - 'Yu-Cheng Tsai' # Your Teams display name
           - 'John Doe' # Add other authorized users
   ```

2. **Upload the config**:

   ```bash
   npm run config
   # Select: Upload Project Config
   ```

## Testing

### Test 1: Valid User with Valid Command

1. **In Teams**, go to the channel you configured
2. **Post** a message:

   ```
   /lights-out status
   ```

3. **Expected response** (within ~5 seconds):

   ```
   ✅ Command received: STATUS

   ℹ️ Processing resources... Check this channel for detailed status in ~30 seconds.
   ```

4. **Wait ~30 seconds** for the detailed status notification from the main handler

### Test 2: Valid User with Invalid Command

1. **Post** a message:

   ```
   /lights-out invalid
   ```

2. **Expected response**:

   ```
   ❌ Invalid command

   Usage: /lights-out <command>
   Commands: start, stop, status, discover
   ```

### Test 3: Unauthorized User (if whitelist is configured)

1. **Ask a colleague** (not in `allowed_users`) to post:

   ```
   /lights-out start
   ```

2. **Expected response**:

   ```
   ❌ Unauthorized: You are not allowed to execute commands.

   Please contact your administrator if you need access.
   ```

### Test 4: Non-Command Message

1. **Post** a normal message:

   ```
   Hey team, how's everyone doing?
   ```

2. **Expected**: No response (flow doesn't trigger because message doesn't start with `/lights-out`)

## Troubleshooting

### Issue: No Response in Teams

**Symptom**: You post `/lights-out start` but get no response

**Possible Causes**:

1. **Flow not running**
   - Check: Open Power Automate → My flows → "Lights-Out Teams Bot" → Ensure it's "On"
   - Fix: Turn on the flow

2. **Flow failed**
   - Check: Open flow → "Run history" → Click failed run → View error details
   - Common errors:
     - `401 Unauthorized`: API key is incorrect
     - `400 Bad Request`: Request body format is incorrect
     - `500 Internal Error`: Lambda execution error

3. **Wrong channel**
   - Check: Ensure you're posting in the channel configured in the flow trigger
   - Fix: Either post in the correct channel or update the flow trigger

### Issue: 401 Unauthorized Error

**Symptom**: Flow run history shows "HTTP 401" error

**Possible Causes**:

1. **API key mismatch**
   - Check: Verify the API key in the HTTP action matches the one in SSM
   - Fix: Regenerate API key and update both SSM and flow

2. **API key not uploaded to SSM**
   - Check: Run `aws ssm get-parameter --name /lights-out/{stage}/power-automate-api-key --with-decryption`
   - Fix: Run `npm run config` → "Generate Power Automate API Key"

### Issue: User Unauthorized (even though in whitelist)

**Symptom**: Response says "Unauthorized" but user is in `allowed_users`

**Possible Causes**:

1. **Display name mismatch**
   - Check: Power Automate sends `displayName` which might be different from expected
   - Debug: Check CloudWatch Logs for the actual user name received
   - Fix: Update `allowed_users` with the correct display name (case-insensitive)

2. **Config not uploaded**
   - Check: Run `aws ssm get-parameter --name /lights-out/{stage}/config`
   - Fix: Run `npm run config` → "Upload Project Config"

### Issue: Lambda Error (500)

**Symptom**: Flow shows "HTTP 500" error

**Troubleshooting Steps**:

1. **Check CloudWatch Logs**:
   - Go to AWS Console → CloudWatch → Log groups
   - Find `/aws/lambda/lights-out-{stage}-power-automate-webhook`
   - Look for error messages

2. **Common errors**:
   - `STAGE environment variable not set`: Lambda environment config issue
   - `Failed to load config from SSM`: SSM parameter not found
   - `Failed to invoke main handler`: Main Lambda not deployed or permission issue

3. **Verify deployment**:
   ```bash
   npm run deploy
   ```

### Debugging Tips

**View Flow Run History**:

1. Open Power Automate
2. Go to "My flows"
3. Click "Lights-Out Teams Bot"
4. Click "Run history"
5. Click a specific run to see step-by-step execution

**View Lambda Logs**:

```bash
# Tail logs in real-time
aws logs tail /aws/lambda/lights-out-{stage}-power-automate-webhook --follow

# View recent logs
aws logs tail /aws/lambda/lights-out-{stage}-power-automate-webhook --since 5m
```

**Test Lambda Directly** (bypass Power Automate):

```bash
curl -X POST \
  "https://xxxxx.execute-api.../webhook/power-automate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <API_KEY>" \
  -d '{
    "user": "Your Name",
    "command": "/lights-out status"
  }'

# Expected response:
# {
#   "success": true,
#   "message": "✅ Command received: STATUS\n\nℹ️ Processing..."
# }
```

## Security Best Practices

1. **API Key Protection**:
   - ✅ Store API key in SSM as SecureString
   - ✅ Never commit API key to Git
   - ✅ Rotate API key periodically (regenerate monthly)
   - ❌ Don't share API key via email or chat

2. **Whitelist Management**:
   - ✅ Always configure `allowed_users` in production
   - ✅ Use full display names ("John Doe" not "jdoe")
   - ✅ Remove users when they leave the team
   - ❌ Don't leave whitelist empty in production (allows all users)

3. **Flow Permissions**:
   - ✅ Limit flow to specific channels (not entire team)
   - ✅ Review flow permissions regularly
   - ✅ Disable flow when not in use (e.g., during maintenance)
   - ❌ Don't share flow ownership unnecessarily

4. **Monitoring**:
   - ✅ Set up CloudWatch alarms for Lambda errors
   - ✅ Review flow run history weekly
   - ✅ Monitor unauthorized access attempts
   - ❌ Don't ignore failed runs

## Advanced Configuration

### Multiple Environments

To set up multiple flows for different environments (dev, staging, prod):

1. **Generate separate API keys** for each environment:

   ```bash
   npm run config -- --project airsync-dev
   npm run config -- --project airsync-staging
   npm run config -- --project airsync-prod
   ```

2. **Create separate flows** with different names:
   - "Lights-Out Bot (Dev)"
   - "Lights-Out Bot (Staging)"
   - "Lights-Out Bot (Prod)"

3. **Point to different Lambda endpoints**:
   - Dev: `https://...execute-api.../airsync-dev/webhook/power-automate`
   - Staging: `https://...execute-api.../airsync-staging/webhook/power-automate`
   - Prod: `https://...execute-api.../airsync-prod/webhook/power-automate`

### Custom Command Prefix

If you want to change the command prefix from `/lights-out` to something else:

1. **Update the condition** in Power Automate flow:
   - Change "starts with `/lights-out`" to your preferred prefix

2. **Update the Lambda handler** ([src/functions/power-automate-webhook/index.ts:155](src/functions/power-automate-webhook/index.ts:155)):

   ```typescript
   // Change this line to match your prefix
   const commandText = request.command.startsWith('/your-prefix')
     ? request.command.substring('/your-prefix'.length + 1)
     : request.command;
   ```

3. **Redeploy**:
   ```bash
   npm run deploy
   ```

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Main project documentation
- [deployment-guide.md](./deployment-guide.md) - Complete deployment guide
- [Known Issues - Teams Outgoing Webhook Bug](../CLAUDE.md#issue-3-microsoft-teams-outgoing-webhook-創建失敗--platform-bug)

## Support

If you encounter issues not covered in this guide:

1. Check CloudWatch Logs (as shown in Troubleshooting)
2. Review Power Automate run history
3. Test Lambda directly with curl (as shown above)
4. Contact your DevOps team with:
   - Flow run ID
   - CloudWatch log excerpt
   - Error message screenshot
