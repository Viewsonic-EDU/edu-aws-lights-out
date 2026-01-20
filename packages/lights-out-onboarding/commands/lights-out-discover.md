# AWS Lights Out Resource Discovery

引導使用者探索 AWS 資源並產出 Lights Out 分析報告。

## 工作流程

### Step 1: 確認專案位置

首先，確認目前是否在 `aws-lights-out-plan` 專案目錄中。檢查當前目錄是否存在 `serverless.yml` 和 `src/` 目錄。

如果不在正確的專案目錄：

- 提醒使用者切換到 lights-out-plan 專案目錄
- 提供指引如何找到正確的專案位置

### Step 2: 驗證 AWS Credentials

使用 `verify_credentials` tool 驗證 AWS 認證狀態。

**成功時：**

- 顯示 AWS 帳號 ID 和 ARN
- 詢問使用者是否要繼續探索資源

**失敗時：**

- 顯示錯誤訊息
- 引導使用者執行 `aws sso login --profile <profile-name>`
- 等待使用者確認已完成登入後再試一次

### Step 3: 選擇要掃描的 Region

向使用者展示常用的 AWS region 選項：

| Region           | Location    |
| ---------------- | ----------- |
| `ap-southeast-1` | Singapore   |
| `ap-northeast-1` | Tokyo       |
| `us-east-1`      | N. Virginia |
| `us-west-2`      | Oregon      |
| `eu-west-1`      | Ireland     |

使用 AskUserQuestion 工具讓使用者選擇要掃描的 regions（可多選）。

預設建議：`ap-southeast-1`（新加坡）

### Step 4: 探索資源

同時呼叫以下 tools 來探索資源：

1. `discover_ecs_services` - 探索 ECS Services
2. `discover_rds_instances` - 探索 RDS Instances

探索時顯示進度，完成後顯示摘要表格：

```
發現的資源：
- ECS Services: X 個
- RDS Instances: Y 個
- 已配置 lights-out: Z 個
```

如果沒有發現任何資源：

- 提示使用者可能的原因（region 選擇錯誤、權限不足等）
- 提供重新選擇 region 的選項

### Step 5: 產出分析報告

呼叫 `analyze_resources` tool 分析發現的資源，並產出 Markdown 格式的報告。

報告包含：

1. **摘要統計** - 掃描的 region 數、資源總數
2. **ECS Services 表格** - 列出所有服務及其狀態
3. **RDS Instances 表格** - 列出所有實例及其狀態
4. **建議事項** - 每個資源的 Lights Out 配置建議

### Step 6: 後續步驟引導

報告產出後，提供後續步驟引導：

1. **如何加入 Tags：**

   ```bash
   # ECS Service
   aws ecs tag-resource \
     --resource-arn <service-arn> \
     --tags key=lights-out:managed,value=true \
            key=lights-out:env,value=dev \
            key=lights-out:priority,value=50

   # RDS Instance
   aws rds add-tags-to-resource \
     --resource-name <instance-arn> \
     --tags Key=lights-out:managed,Value=true \
            Key=lights-out:env,Value=dev \
            Key=lights-out:priority,Value=100
   ```

2. **配置檔案範例：**
   提供基於分析結果的 `config/xxx.yml` 配置範例

3. **下一步：**
   - 執行 `/lights-out-configure` 來生成配置檔
   - 執行 `npm run deploy` 來部署 Lambda

## 注意事項

- 此命令只會讀取 AWS 資源資訊，不會進行任何修改
- 探索需要以下 IAM 權限：
  - `ecs:ListClusters`, `ecs:ListServices`, `ecs:DescribeServices`
  - `rds:DescribeDBInstances`
  - `application-autoscaling:DescribeScalableTargets`
  - `sts:GetCallerIdentity`
- 如果帳號中資源較多，探索過程可能需要一些時間

## MCP Tools 使用

此命令使用 `lights-out-discovery` MCP Server 提供的以下 tools：

- `verify_credentials` - 驗證 AWS 認證
- `discover_ecs_services` - 探索 ECS Services
- `discover_rds_instances` - 探索 RDS Instances
- `analyze_resources` - 分析資源並產出報告
