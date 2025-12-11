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

## AI Agent Rules

**CRITICAL - DO NOT AUTO-EXECUTE:**
- ❌ **NEVER** 自動執行 `pytest` 或任何測試指令
- ❌ **NEVER** 自動執行 `python app.py` 或主程式
- ❌ **NEVER** 自動執行 `aws lambda invoke`
- ✅ **ALWAYS** 僅提供指令，由開發者在已啟動虛擬環境的終端中執行

**Why:** 開發者使用獨立虛擬環境管理依賴，AI Agent 執行會因環境不一致而失敗。

## Quick Commands

```bash
# 本地測試（需在虛擬環境中執行）
pytest tests/ -v

# 單一模組測試
pytest tests/unit/core/test_config.py -v

# 打包
cd src/lambda && zip -r ../../function.zip . -x "*.pyc" "__pycache__/*"

# 手動觸發
aws lambda invoke --function-name lights-out --payload '{"action":"status"}' out.json
```

## Related Docs

- [AGENTS.md](./AGENTS.md) — 多 Agent 協作 + 技術規格
- [TASKS.md](./TASKS.md) — 任務追蹤
- [docs/tagging-guide.md](./docs/tagging-guide.md) — 標籤操作指南
