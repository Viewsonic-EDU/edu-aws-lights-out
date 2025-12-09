# AWS Lights Out Plan

## Context

自動在非工作時間關閉 AWS 開發環境資源（ECS Service 等）以節省成本。支援 Tag-based 資源發現，為未來 MCP AI Agent 整合做準備。

## Tech Stack

- **Runtime:** Python 3.11 + AWS Lambda
- **Trigger:** EventBridge (cron) + SSM Parameter Store (config)
- **Discovery:** Resource Groups Tagging API
- **Logging:** 結構化 JSON

## Architecture

```
src/lambda/
├── app.py              # Lambda 進入點
├── core/
│   ├── config.py       # SSM 配置載入
│   ├── scheduler.py    # 時區/假日判斷
│   └── orchestrator.py # 執行協調
├── discovery/
│   └── tag_discovery.py
├── handlers/
│   ├── base.py         # Handler 介面
│   └── ecs_service.py  # Phase 1 實作
└── utils/
    └── logger.py
```

**Why this structure:**
- `handlers/` 模組化：新增資源類型只需加檔案，不動既有程式碼
- `discovery/` 抽象化：配置與程式碼分離，資源清單不寫死
- `core/` 業務邏輯：不直接呼叫 boto3，方便測試

## Conventions

**Tags（必須）:**
```
lights-out:managed  = true
lights-out:env      = workshop
lights-out:priority = 100    # 小=先啟動/後關閉
```

**Lambda actions:** `start`, `stop`, `status`, `discover`

**Error handling:** 單一資源失敗不中斷整體流程

**Commits:** `<type>(<scope>): <description>`
- type: `feat|fix|docs|refactor|test`
- scope: `core|discovery|handlers|config`

## Quick Commands

```bash
# 本地測試
python -m pytest tests/ -v

# 打包
cd src/lambda && zip -r ../../function.zip . -x "*.pyc" "__pycache__/*"

# 手動觸發
aws lambda invoke --function-name lights-out --payload '{"action":"status"}' out.json
```

## Related Docs

- [AGENTS.md](./AGENTS.md) — 多 Agent 協作 + 技術規格
- [TASKS.md](./TASKS.md) — 任務追蹤
- [docs/tagging-guide.md](./docs/tagging-guide.md) — 標籤操作指南
