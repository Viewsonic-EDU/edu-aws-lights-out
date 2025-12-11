# AWS Lights Out Plan

> 自動在非工作時間關閉 AWS 開發環境資源（ECS Service、NAT Gateway 等）以節省成本。支援 Tag-based 資源發現，為未來 MCP AI Agent 整合做準備。

## 📋 專案概述

**目標:** 降低非營業時間的 AWS 成本（預估節省 60-70%）
**範圍:** Workshop/Staging 環境
**架構:** Serverless（Lambda + EventBridge + SSM Parameter Store）

### 核心功能

- ✅ Tag-based 資源自動發現
- ✅ 排程啟動/停止（支援時區、假日）
- ✅ 資源優先級控制（避免依賴問題）
- ✅ Dry-run 模式（安全測試）
- 🚧 未來支援 MCP AI Agent 手動控制

---

## 🛠️ 技術棧

| 類別 | 技術 |
|------|------|
| **Runtime** | Python 3.11 |
| **Deployment** | AWS Lambda (Serverless) |
| **Trigger** | EventBridge (Cron) |
| **Config** | SSM Parameter Store (JSON) |
| **Discovery** | Resource Groups Tagging API |
| **Logging** | 結構化 JSON (CloudWatch Logs) |
| **IaC** | 手動部署 → SAM (Phase 2) |

### 開發工具

- **Testing:** pytest + moto (AWS mock)
- **Type Checking:** mypy
- **Code Quality:** black, ruff
- **Workflow:** TDD (Test-Driven Development)

---

## 🚀 快速開始

### 前置需求

- **Python:** 3.11+ ([安裝指南](https://www.python.org/downloads/))
- **AWS CLI:** 已配置 (用於手動部署)
- **權限:** 能存取目標 AWS 帳號

### 本機開發環境設置

```bash
# 1. Clone 專案
git clone https://github.com/ViewSonic/aws-lights-out-plan.git
cd aws-lights-out-plan

# 2. 建立 Python 虛擬環境（Python 3.11）
python3.11 -m venv .venv

# 3. 啟動虛擬環境
source .venv/bin/activate  # macOS/Linux
# .venv\Scripts\activate   # Windows

# 4. 升級 pip 並安裝開發依賴
pip install --upgrade pip
pip install -r requirements-dev.txt

# 5. 驗證安裝
python --version  # 應顯示 Python 3.11.x
pytest --version
mypy --version
```

### 執行測試

```bash
# 執行所有測試（含 coverage）
pytest

# 僅執行單元測試（快速）
pytest -m unit

# 執行特定測試檔案
pytest tests/unit/test_utils_logger.py -v

# 產生 HTML coverage 報告
pytest --cov-report=html
open htmlcov/index.html  # 開啟報告
```

### 型別檢查

```bash
# 檢查整個專案
mypy src/lambda_function

# 檢查特定檔案
mypy src/lambda_function/utils/logger.py
```

---

## 📁 專案結構

```
aws-lights-out-plan/
├── src/lambda_function/     # Lambda 程式碼（部署包）
│   ├── app.py               # Lambda 進入點
│   ├── core/                # 核心業務邏輯
│   │   ├── config.py        # SSM 配置載入
│   │   ├── scheduler.py     # 時區/假日判斷
│   │   └── orchestrator.py  # 執行協調
│   ├── discovery/           # 資源發現模組
│   │   ├── base.py          # 介面定義
│   │   └── tag_discovery.py # Tag-based 實作
│   ├── handlers/            # 資源處理器（可擴充）
│   │   ├── base.py          # Handler 抽象類別
│   │   ├── ecs_service.py   # ECS Service 處理
│   │   └── nat_gateway.py   # NAT Gateway 處理（Phase 2）
│   └── utils/
│       └── logger.py        # 結構化 logging
├── tests/
│   ├── unit/                # 單元測試（使用 moto mock）
│   └── integration/         # 整合測試（可選）
├── docs/
│   ├── deployment-guide.md  # 部署指南
│   └── tagging-guide.md     # 標籤操作手冊
├── requirements.txt         # 生產依賴
├── requirements-dev.txt     # 開發依賴
├── pytest.ini               # pytest 配置
├── AGENTS.md                # Agent 協作文件
├── TASKS.md                 # 任務追蹤
└── CLAUDE.md                # AI Agent 專案規範

**Why this structure:**
- `handlers/` 模組化：新增資源類型只需加檔案，不動既有程式碼
- `discovery/` 抽象化：配置與程式碼分離，資源清單不寫死
- `core/` 業務邏輯：不直接呼叫 boto3，方便測試
```

---

## 🏷️ 資源標籤規範

所有需要管理的資源**必須**具備以下標籤：

```
lights-out:managed  = true              # 是否納管
lights-out:env      = workshop          # 環境名稱（workshop/staging）
lights-out:priority = 100               # 優先級（數字越小越先啟動/越後關閉）
lights-out:schedule = default           # 排程群組（可選）
```

**範例:**
```bash
# ECS Service 標籤
aws ecs tag-resource \
  --resource-arn arn:aws:ecs:ap-southeast-1:123456789012:service/my-cluster/my-service \
  --tags key=lights-out:managed,value=true \
         key=lights-out:env,value=workshop \
         key=lights-out:priority,value=50
```

詳見 [docs/tagging-guide.md](./docs/tagging-guide.md)

---

## 🔧 本地測試

### 模擬 Lambda 執行

```bash
# 測試資源發現
python -m src.lambda.app discover

# 測試停止動作（dry-run）
DRY_RUN=true python -m src.lambda.app stop

# 測試啟動動作（dry-run）
DRY_RUN=true python -m src.lambda.app start
```

### 打包部署

```bash
# 建立部署包
cd src/lambda_function
zip -r ../../function.zip . -x "*.pyc" "__pycache__/*" "*.md"
cd ../..

# 驗證打包內容
unzip -l function.zip
```

---

## 📖 相關文件

- **[AGENTS.md](./AGENTS.md)** - 多 Agent 協作規範 + 技術規格
- **[TASKS.md](./TASKS.md)** - Milestone 與任務追蹤
- **[CLAUDE.md](./CLAUDE.md)** - AI Agent 專案規範
- **[docs/deployment-guide.md](./docs/deployment-guide.md)** - 部署操作手冊
- **[docs/tagging-guide.md](./docs/tagging-guide.md)** - 資源標籤指南

---

## 🤝 開發協作

### Commit 規範

```
<type>(<scope>): <description>

type: feat|fix|docs|refactor|test|chore
scope: core|discovery|handlers|config|docs
```

**範例:**
```bash
git commit -m "feat(handlers): implement ECS service handler"
git commit -m "test(core): add config loader unit tests"
git commit -m "docs(deployment): update Lambda IAM requirements"
```

### TDD 工作流程

1. **Red** - 撰寫失敗的測試 (`tests/`)
2. **Green** - 實作最少程式碼讓測試通過 (`src/`)
3. **Refactor** - 重構程式碼（保持測試通過）

詳見 [AGENTS.md - TDD Development Workflow](./AGENTS.md#tdd-development-workflow)

### Code Review Checklist

- [ ] Type hints 完整
- [ ] Docstring 有撰寫
- [ ] Error handling 正確（不中斷整體流程）
- [ ] Dry-run 模式有支援
- [ ] Logging 有結構化輸出
- [ ] 測試覆蓋率 ≥ 80%

---

## 📊 專案狀態

### 當前階段

- [x] Phase 0: 專案初始化（文件規劃）
- [ ] Phase 1: ECS Service Handler (MVP)
- [ ] Phase 2: NAT Gateway Handler
- [ ] Phase 3: MCP 整合

### 技術決策

| 決策 | 選擇 | 理由 |
|------|------|------|
| Python 版本 | 3.11 | Lambda 穩定支援 |
| 部署方式 | Console → SAM | 先驗證再自動化 |
| Phase 1 範圍 | 僅 ECS Service | 最小可驗證單元 |

---

## 📝 License

Internal project for ViewSonic development team.

---

## 🙋 支援

- **Issues:** [GitHub Issues](https://github.com/ViewSonic/aws-lights-out-plan/issues)
- **Docs:** 參考 `docs/` 目錄
- **Contact:** DevOps Team
