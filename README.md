# AWS Lights Out Plan

> 自動在非工作時間關閉 AWS 開發環境資源（ECS Service、NAT Gateway 等）以節省成本。支援 Tag-based 資源發現，為未來 MCP AI Agent 整合做準備。

## 📋 專案概述

**目標:** 降低非營業時間的 AWS 成本（預估節省 60-70%）
**範圍:** Workshop/Staging 環境
**架構:** Serverless（Lambda + EventBridge + SSM Parameter Store）

### 核心功能

- ✅ Tag-based 資源自動發現
- ✅ 支援 ECS Service 與 RDS Instance 管理
- ✅ 資源優先級控制（避免依賴問題）
- ✅ TypeScript + AWS SDK v3 實作（現代化架構）
- ✅ Serverless Framework 部署
- 🚧 未來支援更多資源類型
- 🚧 未來支援 MCP AI Agent 手動控制

---

## 🛠️ 技術棧

| 類別 | 技術 |
|------|------|
| **Runtime** | TypeScript (Node.js 20) + AWS SDK v3 |
| **Deployment** | AWS Lambda (Serverless Framework) |
| **Trigger** | EventBridge (Cron) |
| **Config** | SSM Parameter Store (YAML) |
| **Discovery** | Resource Groups Tagging API |
| **Logging** | 結構化 JSON (CloudWatch Logs) |
| **Build** | esbuild (ESM bundling) |

### 開發工具

**TypeScript (主要實作)**:
- **Testing:** Vitest + aws-sdk-client-mock
- **Type Checking:** TypeScript strict mode
- **Bundling:** esbuild + Serverless Framework
- **Testing:** 307 個測試檔案

**Python (原型實作)**:
- **Testing:** pytest + moto (AWS mock)
- **Type Checking:** mypy
- **Code Quality:** black, ruff
- **測試:** 11 個測試檔案，100+ 測試案例

---

## 🚀 快速開始

### 前置需求

- **Node.js:** 20+ (推薦使用 [nvm](https://github.com/nvm-sh/nvm))
- **pnpm:** 最新版本 (`npm install -g pnpm`)
- **AWS CLI:** 已配置 (用於部署)
- **權限:** 能存取目標 AWS 帳號

### 本機開發環境設置（TypeScript）

```bash
# 1. Clone 專案
git clone https://github.com/ViewSonic/aws-lights-out-plan.git
cd aws-lights-out-plan/typescript

# 2. 安裝相依套件
pnpm install

# 3. 驗證安裝
node --version  # 應顯示 v20.x.x
pnpm --version
pnpm tsc --version

# 4. 建置專案
pnpm build

# 5. 執行測試
pnpm test
```

### 執行測試（TypeScript）

```bash
cd typescript

# 執行所有測試
pnpm test

# 監視模式（開發時使用）
pnpm test:watch

# 產生覆蓋率報告
pnpm test:coverage

# 型別檢查
pnpm type-check

# Linting
pnpm lint
```

### Python 原型開發（選用）

```bash
# 1. 建立 Python 虛擬環境（Python 3.11）
python3.11 -m venv .venv

# 2. 啟動虛擬環境
source .venv/bin/activate  # macOS/Linux
# .venv\Scripts\activate   # Windows

# 3. 安裝開發依賴
pip install --upgrade pip
pip install -r requirements-dev.txt

# 4. 執行測試
pytest

# 5. 型別檢查
mypy src/lambda_function
```

---

## 📁 專案結構

```
aws-lights-out-plan/
├── typescript/              # TypeScript 主要實作（生產使用）
│   ├── src/
│   │   ├── index.ts         # Lambda handler 入口
│   │   ├── types.ts         # 共用型別定義
│   │   ├── core/
│   │   │   ├── config.ts    # SSM 配置載入
│   │   │   └── orchestrator.ts  # 執行協調
│   │   ├── discovery/
│   │   │   └── tagDiscovery.ts  # Tag-based 資源發現
│   │   ├── handlers/
│   │   │   ├── base.ts      # Handler 介面
│   │   │   ├── factory.ts   # Factory Pattern
│   │   │   ├── ecsService.ts    # ECS Service Handler
│   │   │   └── rdsInstance.ts   # RDS Instance Handler
│   │   └── utils/
│   │       └── logger.ts    # 結構化 logging
│   ├── tests/               # 307 個測試檔案
│   ├── serverless.yml       # Serverless Framework 設定
│   ├── tsconfig.json        # TypeScript 配置（strict mode）
│   └── package.json         # 相依套件
│
├── src/lambda_function/     # Python 原型實作（參考）
│   ├── app.py               # Lambda 進入點
│   ├── core/                # 核心業務邏輯
│   ├── discovery/           # 資源發現模組
│   ├── handlers/            # 資源處理器
│   └── utils/               # 工具模組
│
├── tests/                   # Python 測試（11 個測試檔案）
├── docs/
│   ├── deployment-guide.md  # 部署指南
│   ├── ssm-operations-guide.md  # SSM 操作指南
│   └── tagging-guide.md     # 標籤操作手冊
├── AGENTS.md                # Agent 協作文件
├── TASKS.md                 # 任務追蹤
└── CLAUDE.md                # AI Agent 專案規範

**Why this structure:**
- `typescript/` 生產實作：使用 TypeScript + AWS SDK v3，現代化架構
- `handlers/` 模組化：新增資源類型只需加檔案，不動既有程式碼
- `discovery/` 抽象化：配置與程式碼分離，資源清單不寫死
- `core/` 業務邏輯：不直接呼叫 AWS SDK，方便測試
- `src/lambda_function/` Python 原型：完整的 Python 實作作為參考
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

## 🔧 本地測試與部署

### 模擬 Lambda 執行（TypeScript）

```bash
cd typescript

# 本地測試（使用 Serverless Offline，選用）
pnpm sls invoke local -f lights-out --data '{"action":"status"}'

# 建置
pnpm build

# 檢查打包大小
ls -lh dist/
```

### 部署至 AWS（TypeScript）

```bash
cd typescript

# 部署至開發環境
pnpm deploy:dev

# 部署至 Staging
pnpm deploy:staging

# 部署至生產環境
pnpm deploy:prod

# 查看 Lambda 日誌
pnpm sls logs -f lights-out --tail
```

### Python 打包（僅供參考）

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
- [x] Phase 1.1: Python 原型實作（ECS Service Handler）
- [x] Phase 1.2: TypeScript 完整實作（ECS + RDS Handler）
- [ ] Phase 1.3: AWS 環境設定與部署
- [ ] Phase 2: 更多資源類型支援（NAT Gateway、Lambda 等）
- [ ] Phase 3: MCP 整合

### 技術決策

| 決策 | 選擇 | 理由 | 日期 |
|------|------|------|------|
| 主要語言 | TypeScript | 現代化、型別安全、AWS SDK v3 | 2025-12-23 |
| Runtime | Node.js 20 | Lambda 最新穩定版本 | 2025-12-23 |
| 部署方式 | Serverless Framework | 自動化部署、簡化配置 | 2025-12-23 |
| 打包工具 | esbuild | 快速、輕量級打包 | 2025-12-23 |
| Phase 1 範圍 | ECS + RDS | 涵蓋常用資源類型 | 2025-12-23 |
| Python 版本 | 3.11 (原型) | 完整的參考實作 | 2025-12-17 |

---

## 📝 License

Internal project for ViewSonic development team.

---

## 🙋 支援

- **Issues:** [GitHub Issues](https://github.com/ViewSonic/aws-lights-out-plan/issues)
- **Docs:** 參考 `docs/` 目錄
- **Contact:** DevOps Team
