# Deployment Guide

> **注意：** 本指南假設 Phase 1 程式碼已開發完成。當前專案仍在開發階段。

## Phase 1: Console 手動部署

### 前置條件

- AWS CLI 已設定 (`aws configure`)
- 有權限建立 Lambda、IAM Role、SSM Parameter
- Workshop 環境的 ECS Service 還在運作
- Phase 1 程式碼已完成（src/lambda/ 目錄）

### Step 1: 建立 IAM Role

1. **IAM** → **Roles** → **Create role**
2. **Trusted entity:** AWS service → Lambda
3. **Role name:** `lights-out-lambda-role`
4. 建立後，附加 inline policy：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECS",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService",
        "ecs:ListServices",
        "ecs:DescribeClusters"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Tagging",
      "Effect": "Allow",
      "Action": ["tag:GetResources"],
      "Resource": "*"
    },
    {
      "Sid": "SSM",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:ap-southeast-1:*:parameter/lights-out/*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

### Step 2: 建立 SSM Parameter

1. **Systems Manager** → **Parameter Store** → **Create parameter**
2. **Name:** `/lights-out/workshop/config`
3. **Type:** String
4. **Value:**

```json
{
  "version": "1.0",
  "environment": "workshop",
  "region": "ap-southeast-1",
  "discovery": {
    "method": "tags",
    "tag_filters": {
      "lights-out:managed": "true",
      "lights-out:env": "workshop"
    },
    "resource_types": ["ecs-service"]
  },
  "resource_defaults": {
    "ecs-service": {
      "wait_for_stable": false,
      "stable_timeout_seconds": 300,
      "default_desired_count": 1
    }
  },
  "overrides": {},
  "schedules": {
    "default": {
      "timezone": "Asia/Taipei",
      "start_time": "09:00",
      "stop_time": "19:00",
      "active_days": ["MON", "TUE", "WED", "THU", "FRI"],
      "holidays": []
    }
  }
}
```

### Step 3: 為 ECS Service 加標籤

參考 [tagging-guide.md](./tagging-guide.md)

### Step 4: 打包 Lambda

```bash
cd src/lambda
zip -r ../../function.zip . -x "*.pyc" -x "__pycache__/*" -x "*.pytest_cache/*"
cd ../..
```

### Step 5: 建立 Lambda Function

1. **Lambda** → **Create function**
2. **Function name:** `lights-out`
3. **Runtime:** Python 3.11
4. **Architecture:** x86_64
5. **Execution role:** 選擇 `lights-out-lambda-role`
6. 建立後：
   - **Configuration** → **General configuration** → Edit
     - Memory: 256 MB
     - Timeout: 5 minutes
   - **Configuration** → **Environment variables** → Edit
     - `CONFIG_PARAMETER_PATH` = `/lights-out/workshop/config`
     - `LOG_LEVEL` = `INFO`
7. **Code** → **Upload from** → **.zip file** → 上傳 `function.zip`
8. **Runtime settings** → Edit
   - Handler: `app.handler`

### Step 6: 測試

```bash
# 測試 discover
aws lambda invoke \
  --function-name lights-out \
  --payload '{"action": "discover"}' \
  --cli-binary-format raw-in-base64-out \
  output.json && cat output.json

# 測試 status
aws lambda invoke \
  --function-name lights-out \
  --payload '{"action": "status"}' \
  --cli-binary-format raw-in-base64-out \
  output.json && cat output.json

# 測試 stop (dry-run)
aws lambda invoke \
  --function-name lights-out \
  --payload '{"action": "stop", "dry_run": true}' \
  --cli-binary-format raw-in-base64-out \
  output.json && cat output.json
```

### Step 7: 建立 EventBridge Rules

#### Stop Rule (每天 19:00 台北時間)

1. **EventBridge** → **Rules** → **Create rule**
2. **Name:** `lights-out-stop`
3. **Schedule:** `cron(0 11 ? * MON-FRI *)` (UTC 11:00 = 台北 19:00)
4. **Target:** Lambda function → `lights-out`
5. **Input:** Constant (JSON text)
   ```json
   {"action": "stop"}
   ```

#### Start Rule (每天 09:00 台北時間)

1. **Name:** `lights-out-start`
2. **Schedule:** `cron(0 1 ? * MON-FRI *)` (UTC 01:00 = 台北 09:00)
3. **Target:** Lambda function → `lights-out`
4. **Input:**
   ```json
   {"action": "start"}
   ```

---

## 之後: SAM 自動化部署

當手動部署驗證完成後，可以導入 SAM 進行自動化。詳見 Phase 2 規劃。
