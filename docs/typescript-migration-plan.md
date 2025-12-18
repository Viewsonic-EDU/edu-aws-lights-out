# Python → TypeScript 迁移计划：PoC 完整验证

## 概览

将现有的 Python Lambda 函数完整迁移至 TypeScript，验证技术可行性并进行性能比较。采用 TDD 方式确保功能对等。

**PoC 目标：**
- ✅ 验证开关灯完整流程（discover → orchestrate → start/stop）
- ✅ 性能比较（cold start、warm execution、bundle size）
- ✅ 完整功能迁移（10 个模块 + 对等测试）
- ✅ 为生产部署提供参考数据

**精简设计原则：**
- **目录结构：** 简单的 `/typescript` 目录（不需要复杂 monorepo）
- **部署方式：** 独立 TypeScript 函数（不需要双函数部署）
- **测试策略：** aws-sdk-client-mock + vitest（80% 覆盖率）
- **时间策略：** 按模块渐进式迁移，无固定截止日期

---

## 1. 精简目录结构（PoC 版本）

```
aws-lights-out-plan/
├── src/lambda_function/             # 保持现有 Python 代码不动
├── tests/                           # 现有 Python 测试
├── requirements.txt
├── pytest.ini
│
└── typescript/                      # 新建 TypeScript PoC
    ├── package.json                 # TS 专案依赖
    ├── tsconfig.json                # Strict mode + path aliases
    ├── vitest.config.ts             # 覆盖率 80% 门槛
    ├── serverless.yml               # 独立部署配置
    ├── src/
    │   ├── index.ts                 # Lambda handler (原 app.py)
    │   ├── core/
    │   │   ├── config.ts
    │   │   ├── scheduler.ts
    │   │   └── orchestrator.ts
    │   ├── discovery/
    │   │   ├── base.ts
    │   │   └── tagDiscovery.ts
    │   ├── handlers/
    │   │   ├── base.ts
    │   │   ├── ecsService.ts
    │   │   └── factory.ts
    │   └── utils/
    │       └── logger.ts
    ├── tests/
    │   ├── unit/
    │   ├── integration/
    │   └── helpers.ts               # Mock 工具（替代 conftest.py）
    └── docs/
        ├── PERFORMANCE.md           # 性能测试报告
        └── MIGRATION-NOTES.md       # 迁移记录

```

**为什么精简：**
- ❌ 不移动 Python 代码（保持现有结构，减少风险）
- ❌ 不需要 monorepo（只有一个 TS 专案）
- ❌ 不需要 /shared 工具（PoC 阶段手动验证即可）
- ✅ 独立的 TypeScript 目录（清楚隔离）

---

## 2. Serverless Framework 配置（精简版）

**关键文件：** `typescript/serverless.yml`

### 核心设计：独立 TypeScript 函数

```yaml
service: lights-out-ts

provider:
  name: aws
  region: ${opt:region, 'ap-southeast-1'}
  stage: ${opt:stage, 'poc'}  # 使用独立 stage 避免冲突

  iam:
    role:
      statements:
        - Effect: Allow
          Action: [ssm:GetParameter]
          Resource: arn:aws:ssm:${aws:region}:${aws:accountId}:parameter/lights-out/*
        - Effect: Allow
          Action: [tag:GetResources]
          Resource: '*'
        - Effect: Allow
          Action: [ecs:DescribeServices, ecs:UpdateService]
          Resource: '*'

  environment:
    CONFIG_PARAMETER_NAME: /lights-out/${self:provider.stage}/config
    LOG_LEVEL: ${opt:loglevel, 'INFO'}

functions:
  lights-out:
    handler: dist/index.handler
    runtime: nodejs20.x
    timeout: 300
    memorySize: 512
    tags:
      runtime: typescript
      version: poc

custom:
  esbuild:
    bundle: true
    minify: true
    sourcemap: true
    exclude: ['aws-sdk']
    target: node20
    platform: node

plugins:
  - serverless-esbuild
```

**部署策略：**
```bash
cd typescript
pnpm install
serverless deploy --stage poc
```

**精简理由：**
- ❌ 不需要双函数配置（Python 保持独立部署）
- ❌ 不需要 runtime switching（PoC 使用独立 stage）
- ✅ 简单直接，专注于验证 TypeScript 实作

---

## 3. 迁移策略：按复杂度分阶段执行

### 3.1 模块迁移顺序（从简单到复杂）

| 阶段 | 模块 | LOC | 复杂度 | 关键挑战 | 优先级 |
|------|------|-----|--------|---------|--------|
| **Phase 0** | `utils/logger` | 167 | ★☆☆☆☆ | 无依赖，建立测试模式 | **先做** |
| **Phase 1** | `discovery/base` | 34 | ★☆☆☆☆ | Dataclass → Interface | 2 |
| **Phase 1** | `handlers/base` | 159 | ★★☆☆☆ | Abstract class → TS abstract | 3 |
| **Phase 1** | `handlers/factory` | 74 | ★☆☆☆☆ | Dict → Map | 4 |
| **Phase 2** | `core/config` | 70 | ★★☆☆☆ | `@lru_cache` → LRU package | 5 |
| **Phase 2** | `core/scheduler` | 113 | ★★★☆☆ | `zoneinfo` → date-fns-tz | 6 |
| **Phase 3** | `discovery/tagDiscovery` | 224 | ★★★★☆ | boto3 pagination → SDK v3 | 7 |
| **Phase 3** | `handlers/ecsService` | 383 | ★★★★☆ | boto3 ECS → SDK v3, Waiters | **最难** |
| **Phase 4** | `core/orchestrator` | 151 | ★★★☆☆ | Type guards | 9 |
| **Phase 4** | `index.ts` (app.py) | 218 | ★★★☆☆ | Lambda handler entry | 10 |

**总计：** ~1,592 LOC Python → ~2,100 LOC TypeScript（预计 +32% 用于显式类型）

### 3.2 TDD 工作流程（每个模块）

1. **测试先行：** 将 Python 测试档转写为 TypeScript/vitest
2. **实作：** 写 TypeScript 实作直到测试通过
3. **验证覆盖率：** 确保 TS 覆盖率 ≥ Python（允许 ±5% 误差）
4. **提交：** 同时提交测试 + 实作

**关键原则：**
- 每个 Python 测试必须有 1:1 对应的 TS 测试
- `pytest.mark.parametrize` → `test.each()` 或 `describe.each()`
- Moto 状态式 mock → aws-sdk-client-mock + 自定义状态 helper

---

## 4. 技术挑战与解决方案

### 4.1 Python 特性迁移对照表

| Python 特性 | TypeScript 方案 | 套件 |
|------------|----------------|------|
| `@dataclass` | `interface` + `class` 或 `type` | 内建 |
| `@lru_cache` | LRU 缓存 | `lru-cache` |
| `zoneinfo` (时区) | 时区处理 | `date-fns-tz` |
| `PyYAML` | YAML 解析 + Zod 验证 | `js-yaml` + `zod` |
| `boto3.client('ecs')` | ECS Client | `@aws-sdk/client-ecs` |
| `boto3` pagination | Async iterator | `paginateXxx` 或手动 loop |
| `boto3` waiters | Waiters API | `waitUntilXxx` |

### 4.2 关键技术细节

#### A. LRU 缓存实作（config.ts）

```typescript
import { LRUCache } from 'lru-cache';

const configCache = new LRUCache<string, Config>({ max: 128 });

export async function loadConfigFromSSM(parameterName: string): Promise<Config> {
  if (configCache.has(parameterName)) {
    return configCache.get(parameterName)!;
  }
  const config = await fetchFromSSM(parameterName);
  configCache.set(parameterName, config);
  return config;
}
```

#### B. 时区处理（scheduler.ts）

```typescript
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { isWithinInterval } from 'date-fns';

export function isWorkingHours(date: Date, timezone: string, workStart: number, workEnd: number): boolean {
  const zonedTime = utcToZonedTime(date, timezone);
  const hour = zonedTime.getHours();
  return hour >= workStart && hour < workEnd;
}
```

#### C. ECS Waiter（ecsService.ts）

```typescript
import { waitUntilServicesStable } from '@aws-sdk/client-ecs';

await waitUntilServicesStable(
  {
    client: ecsClient,
    maxWaitTime: 300,
    minDelay: 10,
  },
  {
    cluster: clusterName,
    services: [serviceName],
  }
);
```

#### D. AWS SDK v3 Pagination

```typescript
import { paginateGetResources } from '@aws-sdk/client-resource-groups-tagging-api';

const paginator = paginateGetResources(
  { client: taggingClient },
  { TagFilters: [...] }
);

for await (const page of paginator) {
  for (const resource of page.ResourceTagMappingList ?? []) {
    // 处理资源
  }
}
```

---

## 5. 测试策略：Moto → aws-sdk-client-mock

### 5.1 Vitest 配置

**关键文件：** `typescript/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': './src',
      '@core': './src/core',
      '@handlers': './src/handlers',
    },
  },
});
```

### 5.2 Mock 策略差异

**Python (moto - 状态式):**
```python
@mock_aws
def test_ecs_start():
    ecs = boto3.client('ecs')
    ecs.create_cluster(clusterName='test')
    ecs.create_service(cluster='test', serviceName='my-service', desiredCount=0)
    # 状态会被保留
```

**TypeScript (aws-sdk-client-mock - 无状态):**
```typescript
import { mockClient } from 'aws-sdk-client-mock';

const ecsMock = mockClient(ECSClient);

it('should start ECS service', async () => {
  // 需要明确定义每个 command 的回传值
  ecsMock.on(DescribeServicesCommand).resolves({
    services: [{ desiredCount: 0, runningCount: 0 }]
  });

  ecsMock.on(UpdateServiceCommand).resolves({
    service: { desiredCount: 1 }
  });

  // 测试代码
});
```

### 5.3 状态式 Mock Helper

**关键文件：** `typescript/tests/helpers.ts`

```typescript
/**
 * 模拟 ECS 服务状态（替代 moto 的状态保留功能）
 */
export class MockECSState {
  private services = new Map<string, any>();

  createService(cluster: string, service: string, desiredCount: number) {
    this.services.set(`${cluster}/${service}`, { desiredCount, runningCount: desiredCount });
  }

  updateService(cluster: string, service: string, desiredCount: number) {
    const key = `${cluster}/${service}`;
    const current = this.services.get(key);
    this.services.set(key, { ...current, desiredCount });
  }

  mockDescribeServices(mock: any) {
    mock.on(DescribeServicesCommand).callsFake((input) => {
      const key = `${input.cluster}/${input.services[0]}`;
      return { services: [this.services.get(key)] };
    });
  }
}
```

---

## 6. 性能测试方案（PoC 关键验证）

### 6.1 测试指标

| 指标 | Python 基准 | TypeScript 目标 | 测量方法 |
|------|-------------|----------------|----------|
| **Cold Start** | TBD | < 3 秒 | CloudWatch Logs (Init Duration) |
| **Warm Execution** | TBD | < 500 ms | CloudWatch Logs (Duration) |
| **Bundle Size** | N/A (解释型) | < 5 MB | `du -h dist/` |
| **Memory Usage** | 512 MB | 512 MB | CloudWatch Metrics (Max Memory Used) |

### 6.2 性能测试脚本

**关键文件：** `typescript/scripts/performance-test.sh`

```bash
#!/bin/bash
# 性能测试脚本

FUNCTION_NAME="lights-out-ts-poc"
ITERATIONS=10

echo "Testing Cold Start..."
for i in $(seq 1 $ITERATIONS); do
  aws lambda invoke --function-name $FUNCTION_NAME --payload '{"action":"status"}' /tmp/out.json
  sleep 60  # 等待 Lambda cold start
done

echo "Testing Warm Execution..."
for i in $(seq 1 $ITERATIONS); do
  aws lambda invoke --function-name $FUNCTION_NAME --payload '{"action":"status"}' /tmp/out.json
  sleep 1  # 保持 warm
done

echo "Analyzing results..."
aws logs tail /aws/lambda/$FUNCTION_NAME --format short --since 1h | grep "REPORT"
```

### 6.3 性能报告模板

**关键文件：** `typescript/docs/PERFORMANCE.md`

```markdown
# TypeScript vs Python 性能比较

## 测试环境
- Region: ap-southeast-1
- Memory: 512 MB
- Payload: {"action": "status"}

## 结果

| 指标 | Python | TypeScript | 差异 |
|------|--------|-----------|------|
| Cold Start (avg) | X ms | Y ms | +Z% |
| Warm Execution (avg) | X ms | Y ms | +Z% |
| Bundle Size | N/A | X MB | - |
| Memory Used (max) | X MB | Y MB | +Z% |

## 结论
[待填写]
```

---

## 7. 依赖安装清单

### 7.1 TypeScript 运行时依赖

**关键文件：** `typescript/package.json`

```json
{
  "name": "lights-out-typescript",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "build": "tsc && esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@aws-sdk/client-ssm": "^3.540.0",
    "@aws-sdk/client-resource-groups-tagging-api": "^3.540.0",
    "@aws-sdk/client-ecs": "^3.540.0",
    "date-fns": "^3.0.0",
    "date-fns-tz": "^2.0.0",
    "js-yaml": "^4.1.0",
    "lru-cache": "^10.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.133",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.11.0",
    "@vitest/coverage-v8": "^1.2.0",
    "aws-sdk-client-mock": "^3.0.1",
    "esbuild": "^0.19.0",
    "typescript": "^5.3.0",
    "vitest": "^1.2.0"
  }
}
```

### 7.2 NPM Scripts（常用指令）

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "build": "tsc && esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js",
    "deploy": "serverless deploy --stage poc",
    "deploy:prod": "serverless deploy --stage prod",
    "perf-test": "bash scripts/performance-test.sh",
    "lint": "eslint src --ext .ts"
  }
}
```

**精简理由：**
- ❌ 不需要 monorepo 配置（pnpm-workspace.yaml）
- ❌ 不需要 verify-parity 脚本（PoC 手动验证即可）
- ✅ 专注于开发、测试、部署流程

---

## 8. PoC 成功标准

### 完成检查清单

- [ ] **代码对等**
  - [ ] 10 个 Python 模块都有 TS 对应实作
  - [ ] 所有模块通过 TypeScript strict mode 编译

- [ ] **测试对等**
  - [ ] 10 个测试档案 1:1 对应迁移
  - [ ] 测试覆盖率：TypeScript ≥ 80%（与 Python 对等）
  - [ ] 所有单元测试通过
  - [ ] 集成测试通过

- [ ] **功能验证**
  - [ ] 部署至 `poc` stage 成功
  - [ ] 手动测试 4 个 actions (start/stop/status/discover)
  - [ ] 验证与 Python 版本功能对等（相同 payload → 相同结果）

- [ ] **性能验证（关键）**
  - [ ] Cold Start < 3 秒
  - [ ] Warm Execution < 500 ms
  - [ ] Bundle Size < 5 MB
  - [ ] 完成性能比较报告（PERFORMANCE.md）

- [ ] **文档**
  - [ ] `PERFORMANCE.md` (性能测试报告)
  - [ ] `MIGRATION-NOTES.md` (迁移过程与技术挑战记录)
  - [ ] 更新 `CLAUDE.md` 添加 TypeScript PoC 说明

---

## 9. PoC 风险与缓解

| 风险 | 机率 | 影响 | 缓解措施 |
|------|------|------|----------|
| AWS SDK v3 API 差异导致行为不一致 | 高 | 高 | 详细对比测试，必要时建立 adapter layer |
| 测试覆盖率低于 80% | 中 | 中 | 严格遵循 TDD，每个模块完成后检查覆盖率 |
| 时区计算差异（zoneinfo vs date-fns-tz） | 中 | 高 | 使用 parametrized 测试验证边界情况 |
| 性能不如预期（Cold Start > 3s） | 中 | 低 | PoC 重点在验证，性能可后续优化（如使用 Lambda SnapStart） |
| ECS Waiter 行为差异 | 低 | 中 | 详细测试 `waitUntilServicesStable` 超时和重试逻辑 |

**PoC 失败处理：**
- TypeScript PoC 独立于生产环境 Python 版本
- 失败时可直接废弃 `/typescript` 目录
- 成本仅为开发时间投入，无生产影响

---

## 10. 关键档案清单（执行时参考）

| 优先级 | 档案路径 | 用途 |
|-------|---------|------|
| **P0** | `typescript/serverless.yml` | 独立 TypeScript 函数部署配置 |
| **P0** | `typescript/package.json` | TS 依赖清单 + npm scripts |
| **P0** | `typescript/tsconfig.json` | Strict mode 配置 + path aliases |
| **P0** | `typescript/vitest.config.ts` | 测试配置（80% 门槛） |
| **P1** | `typescript/tests/helpers.ts` | Mock 工具（状态式 ECS mock） |
| **P1** | `typescript/scripts/performance-test.sh` | 性能测试脚本 |
| **P2** | `typescript/src/handlers/ecsService.ts` | 最复杂模块（383 LOC） |
| **P2** | `typescript/src/core/config.ts` | LRU cache + SSM 整合 |
| **P2** | `typescript/src/core/scheduler.ts` | 时区处理逻辑 |
| **P3** | `typescript/docs/PERFORMANCE.md` | 性能测试报告模板 |

---

## 11. 下一步行动（立即可开始）

### Phase 0：初始化 TypeScript PoC（30 分钟）

```bash
# 1. 创建 TypeScript 目录
mkdir -p typescript/{src,tests,scripts,docs}

# 2. 初始化专案
cd typescript
pnpm init

# 3. 安装核心依赖
pnpm add @aws-sdk/client-ssm @aws-sdk/client-ecs @aws-sdk/client-resource-groups-tagging-api
pnpm add date-fns date-fns-tz js-yaml lru-cache zod

# 4. 安装开发依赖
pnpm add -D typescript @types/node @types/aws-lambda @types/js-yaml
pnpm add -D vitest @vitest/coverage-v8 aws-sdk-client-mock
pnpm add -D esbuild serverless serverless-esbuild

# 5. 创建配置文件
# - tsconfig.json（参考第 7.1 节）
# - vitest.config.ts（参考第 5.1 节）
# - serverless.yml（参考第 2 节）
```

### Phase 1：第一个模块验证（建立 TDD 流程）

**目标：迁移 `utils/logger.ts` 验证整体流程**

1. 创建 `src/utils/logger.ts`
2. 创建 `tests/unit/utils/logger.test.ts`
3. 运行 `pnpm test` 确认测试通过
4. 运行 `pnpm test:coverage` 确认覆盖率 ≥ 80%

### Phase 2-4：按模块复杂度迁移

参考第 3.1 节顺序，逐步迁移剩余 9 个模块。

### Phase 5：性能验证

1. 部署至 `poc` stage
2. 运行 `pnpm perf-test`
3. 完成 `docs/PERFORMANCE.md` 报告

**关键原则：每完成一个模块,立即验证测试和覆盖率，确保流程顺畅再继续下一个。**
