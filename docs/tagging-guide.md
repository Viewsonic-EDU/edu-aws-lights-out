# Tagging Guide

如何標記 AWS 資源以納入 Lights Out 自動排程。基於 sss-lab 環境的實際部署經驗整理。

## 必要標籤

| Tag Key | 說明 | 必填 | 範例 |
|---------|------|------|------|
| `lights-out:managed` | 是否納入管理 | ✅ | `true` |
| `lights-out:env` | 環境識別 | ✅ | `sss-lab` |
| `lights-out:priority` | 執行順序 | 選填 | `100` |

### Priority 說明
- **數字越小 = 越早啟動 / 越晚關閉**
- 預設值：100
- 建議範圍：10-200

**實際範例（sss-lab）：**
```
ECS Service: 50   (先啟動，先關閉 - 應用層)
RDS Instance: 100 (後啟動，後關閉 - 資料層)
```

**啟動順序：** ECS (50) → RDS (100)
**關閉順序：** RDS (100) → ECS (50)

確保應用層先啟動再連資料庫，關閉時先斷開連線再關閉資料庫。

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
| `lights-out:env` | `sss-lab` |
| `lights-out:priority` | `50` |

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
    key=lights-out:env,value=sss-lab \
    key=lights-out:priority,value=50 \
  --region ap-southeast-1
```

---

## 標記 RDS Instance

### AWS Console

1. **RDS** → **Databases**
2. 選擇 DB Instance → **Tags** tab
3. 新增標籤：

| Key | Value |
|-----|-------|
| `lights-out:managed` | `true` |
| `lights-out:env` | `sss-lab` |
| `lights-out:priority` | `100` |

### AWS CLI

```bash
aws rds add-tags-to-resource \
  --resource-name arn:aws:rds:ap-southeast-1:ACCOUNT_ID:db:INSTANCE_NAME \
  --tags \
    Key=lights-out:managed,Value=true \
    Key=lights-out:env,Value=sss-lab \
    Key=lights-out:priority,Value=100 \
  --region ap-southeast-1
```

---

## 驗證標籤

確認資源已正確標記：

```bash
# 使用 Resource Groups Tagging API 查詢
aws resourcegroupstaggingapi get-resources \
  --tag-filters \
    Key=lights-out:managed,Values=true \
    Key=lights-out:env,Values=sss-lab \
  --resource-type-filters ecs:service rds:db \
  --region ap-southeast-1

# 或透過 Lambda discover action
aws lambda invoke \
  --function-name lights-out-sss-lab-handler \
  --payload '{"action":"discover"}' \
  --region ap-southeast-1 \
  out.json && cat out.json | jq .
```

---

## Troubleshooting

### 資源沒被發現？

1. **確認標籤拼寫正確** — `lights-out:managed` 不是 `lightsout:managed`
2. **確認 env 標籤匹配** — SSM config 中的 `discovery.tags["lights-out:env"]` 必須為 `sss-lab`
3. **確認資源類型設定** — SSM config 的 `discovery.resource_types` 要包含該資源類型（`ecs:service` 或 `rds:db`）
4. **確認 IAM 權限** — Lambda 需要 `tag:GetResources` 權限

### 查看 Lambda 日誌

```bash
# 即時查看日誌
aws logs tail /aws/lambda/lights-out-sss-lab-handler \
  --follow \
  --region ap-southeast-1 \
  --format short

# 查看最近 10 分鐘的日誌
aws logs tail /aws/lambda/lights-out-sss-lab-handler \
  --region ap-southeast-1 \
  --since 10m
```

## 相關文件

- [deployment-guide.md](./deployment-guide.md) - 完整部署指南
- [ssm-operations-guide.md](./ssm-operations-guide.md) - SSM Parameter 操作指南
- [config/sss-lab.yml](../config/sss-lab.yml) - sss-lab 環境配置範例
