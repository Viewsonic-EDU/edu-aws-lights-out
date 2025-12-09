# Agent Collaboration Guide

> 此文件供多 Agent（Claude Code、Gemini CLI 等）協作使用。包含共享狀態、技術規格、任務追蹤。

---

## 📍 Shared State

### Current Phase
- [x] Phase 0: 專案初始化（文件規劃）
- [ ] Phase 1: ECS Service Handler (MVP)
- [ ] Phase 2: NAT Gateway Handler
- [ ] Phase 3: MCP 整合

### Active Decisions
| 決策 | 選擇 | 理由 | 日期 |
|------|------|------|------|
| Python 版本 | 3.11 | Lambda 穩定支援 | 2025-12-09 |
| 部署方式 | Console → SAM | 先驗證再自動化 | 2025-12-09 |
| Phase 1 範圍 | 僅 ECS Service | 最小可驗證單元 | 2025-12-09 |
| 實作方式 | 漸進式學習 | 邊做邊學，避免一次生成所有程式碼 | 2025-12-09 |

### Blockers
<!-- Agent 遇到阻礙時在此記錄 -->
- None

### File Locks
<!-- 避免同時編輯，開始前登記 -->
| File | Agent | Since |
|------|-------|-------|
| - | - | - |

---

## 📋 Task Registry

### Phase 1: ECS Service MVP

| ID | Task | Status | Agent | Notes |
|----|------|--------|-------|-------|
| P1-01 | 專案結構設計 | 🔲 | - | 建立 src/lambda/ 目錄結構 |
| P1-02 | utils/logger.py | 🔲 | - | 結構化 JSON logging |
| P1-03 | core/config.py | 🔲 | - | SSM Parameter Store 載入 |
| P1-04 | discovery/base.py | 🔲 | - | 資源發現介面定義 |
| P1-05 | discovery/tag_discovery.py | 🔲 | - | Tag-based 資源發現實作 |
| P1-06 | handlers/base.py | 🔲 | - | 資源 Handler 抽象類別 |
| P1-07 | handlers/ecs_service.py | 🔲 | - | ECS Service 啟停邏輯 |
| P1-08 | core/scheduler.py | 🔲 | - | 時區/工作日判斷 |
| P1-09 | core/orchestrator.py | 🔲 | - | 執行協調與錯誤處理 |
| P1-10 | app.py | 🔲 | - | Lambda 進入點 |
| P1-11 | 單元測試 | 🔲 | - | tests/ 目錄，使用 moto |
| P1-12 | 整合測試 | 🔲 | - | 本地測試 |
| P1-13 | 部署 Lambda | 🔲 | - | 手動 Console 部署 |
| P1-14 | 建立 EventBridge | 🔲 | - | start/stop cron rules |
| P1-15 | Workshop 驗證 | 🔲 | - | 端對端測試 |

**Status:** 🔲 Todo | 🔄 In Progress | ✅ Done | ⏸️ Blocked

---

## 🔧 Technical Specifications

### SSM Configuration Schema

**Path:** `/lights-out/{environment}/config`

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
      "wait_for_stable": true,
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

### Interface Definitions

```python
# discovery/base.py
@dataclass
class DiscoveredResource:
    resource_type: str      # "ecs-service"
    arn: str                # Full AWS ARN
    resource_id: str        # Human-readable ID
    priority: int           # From tag, default 50
    group: str              # Schedule group
    tags: dict[str, str]
    metadata: dict

# handlers/base.py
class ResourceHandler(ABC):
    def get_status(self) -> dict: ...
    def start(self) -> HandlerResult: ...
    def stop(self) -> HandlerResult: ...
    def is_ready(self) -> bool: ...
```

### Lambda Response Format

```json
{
  "success": true,
  "action": "stop",
  "dry_run": false,
  "timestamp": "2025-12-09T19:00:00+08:00",
  "environment": "workshop",
  "summary": {
    "total": 1,
    "succeeded": 1,
    "failed": 0,
    "skipped": 0
  },
  "resources": [
    {
      "resource_type": "ecs-service",
      "resource_id": "my-cluster/my-service",
      "status": "success",
      "message": "Service scaled to 0"
    }
  ]
}
```

### IAM Permissions Required

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECS",
      "Effect": "Allow",
      "Action": ["ecs:DescribeServices", "ecs:UpdateService", "ecs:ListServices"],
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
      "Resource": "arn:aws:ssm:*:*:parameter/lights-out/*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "*"
    }
  ]
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONFIG_PARAMETER_PATH` | Yes | - | SSM parameter path |
| `DRY_RUN` | No | `false` | Skip actual operations |
| `LOG_LEVEL` | No | `INFO` | Logging level |

---

## 📚 AWS API Quick Reference

### ECS Service
```python
ecs = boto3.client('ecs')

# Status
ecs.describe_services(cluster='name', services=['svc'])

# Stop
ecs.update_service(cluster='name', service='svc', desiredCount=0)

# Start
ecs.update_service(cluster='name', service='svc', desiredCount=1)
```

### Resource Groups Tagging API
```python
tagging = boto3.client('resourcegroupstaggingapi')

tagging.get_resources(
    TagFilters=[
        {'Key': 'lights-out:managed', 'Values': ['true']},
        {'Key': 'lights-out:env', 'Values': ['workshop']}
    ],
    ResourceTypeFilters=['ecs:service']
)
```

### SSM Parameter Store
```python
ssm = boto3.client('ssm')

response = ssm.get_parameter(
    Name='/lights-out/workshop/config',
    WithDecryption=True
)
config = json.loads(response['Parameter']['Value'])
```

---

## 🤝 Working Agreements

### Agent 分工建議
| Agent | 擅長 | 建議任務 |
|-------|------|----------|
| Claude Code | 架構、複雜邏輯 | handlers、orchestrator |
| Gemini CLI | 文件、測試 | tests、docs、review |

### 溝通協定

1. **開始任務前：** 更新 Task Registry 為 🔄，登記 File Locks
2. **完成任務後：** 更新為 ✅，清除 File Locks，記錄 Notes
3. **遇到阻礙時：** 記錄到 Blockers，狀態改為 ⏸️
4. **重要決策時：** 記錄到 Active Decisions

### Code Review Checklist
- [ ] Type hints 完整
- [ ] Docstring 有寫
- [ ] Error handling 正確（不中斷整體流程）
- [ ] Dry-run 模式有支援
- [ ] Logging 有結構化輸出

---

## 🗂️ File Dependencies

```
app.py
└── core/orchestrator.py
    ├── core/config.py
    │   └── utils/logger.py
    ├── core/scheduler.py
    ├── discovery/tag_discovery.py
    │   └── discovery/base.py
    └── handlers/ecs_service.py
        └── handlers/base.py
```

**建議實作/修改順序：** 由下往上（先改依賴少的）
