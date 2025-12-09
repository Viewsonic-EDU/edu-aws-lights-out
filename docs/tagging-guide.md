# Tagging Guide

如何標記 AWS 資源以納入 Lights Out 自動排程。

## 必要標籤

| Tag Key | 說明 | 必填 | 範例 |
|---------|------|------|------|
| `lights-out:managed` | 是否納入管理 | ✅ | `true` |
| `lights-out:env` | 環境識別 | ✅ | `workshop` |
| `lights-out:priority` | 執行順序 | 選填 | `100` |
| `lights-out:group` | 排程群組 | 選填 | `default` |

### Priority 說明
- 數字越小，越早啟動、越晚關閉
- 預設值：50
- 建議範圍：10-100

```
NAT Gateway: 10  (先啟動，確保網路通)
ECS Service: 100 (後啟動，依賴 NAT)
```

---

## 標記 ECS Service

### AWS Console

1. **ECS** → **Clusters** → 選擇 cluster
2. **Services** tab → 點擊 service 名稱
3. **Tags** tab → **Manage tags**
4. 新增以下標籤：

| Key | Value |
|-----|-------|
| `lights-out:managed` | `true` |
| `lights-out:env` | `workshop` |
| `lights-out:priority` | `100` |

5. **Save**

### AWS CLI

```bash
# 取得 Service ARN
aws ecs list-services --cluster YOUR_CLUSTER_NAME

# 加標籤
aws ecs tag-resource \
  --resource-arn arn:aws:ecs:ap-southeast-1:ACCOUNT_ID:service/CLUSTER/SERVICE \
  --tags \
    key=lights-out:managed,value=true \
    key=lights-out:env,value=workshop \
    key=lights-out:priority,value=100
```

---

## 標記 NAT Gateway (Phase 2)

### AWS Console

1. **VPC** → **NAT gateways**
2. 選擇 NAT Gateway → **Tags** tab → **Manage tags**
3. 新增標籤

### AWS CLI

```bash
aws ec2 create-tags \
  --resources nat-0123456789abcdef \
  --tags \
    Key=lights-out:managed,Value=true \
    Key=lights-out:env,Value=workshop \
    Key=lights-out:priority,Value=10
```

---

## 驗證標籤

確認資源已正確標記：

```bash
# 使用 Resource Groups Tagging API 查詢
aws resourcegroupstaggingapi get-resources \
  --tag-filters \
    Key=lights-out:managed,Values=true \
    Key=lights-out:env,Values=workshop \
  --resource-type-filters ecs:service

# 或透過 Lambda (dry-run)
aws lambda invoke \
  --function-name lights-out \
  --payload '{"action": "discover"}' \
  output.json

cat output.json
```

---

## Troubleshooting

### 資源沒被發現？

1. **確認標籤拼寫正確** — `lights-out:managed` 不是 `lightsout:managed`
2. **確認 tag_filters 設定** — SSM config 的 `lights-out:env` 要匹配
3. **確認 resource_types 設定** — SSM config 要包含該資源類型
4. **確認 IAM 權限** — Lambda 需要 `tag:GetResources` 權限

### 查看 Lambda 日誌

```bash
aws logs tail /aws/lambda/lights-out --follow
```
