# Phase 9 Design: P2 Engineering Closure

## Goal

完成四个 P2 工程收口项：
1. pino redact — 防止 token 泄漏到日志
2. Vitest 单元测试 — 覆盖核心 utils 四个函数
3. export 命名说明 — README 文档补充（无代码改动）
4. README 补全 — `.env`、NDJSON envelope、成本公式修正

---

## Scope

- 不改 schema / migrate.ts
- 不新增 job 或 service
- 不做 service 层集成测试（超出 P2 范围）
- export 目录命名保持不变，只在 README 中说明

---

## Architecture

修改范围：
- `src/utils/logger.ts` — 加入 `redact` 配置
- `src/utils/__tests__/normalize-handle.test.ts` — 新增
- `src/utils/__tests__/classify-error.test.ts` — 新增
- `src/utils/__tests__/estimate-cost.test.ts` — 新增
- `src/utils/__tests__/check-account-enabled.test.ts` — 新增
- `vitest.config.ts` — 新增（最小配置）
- `package.json` — 加 `test` script + vitest devDependency
- `README.md` — 四处补充

---

## File Map

| 操作 | 文件 | 改动内容 |
|---|---|---|
| 修改 | `src/utils/logger.ts` | 加入 `redact.paths` |
| 新增 | `src/utils/__tests__/normalize-handle.test.ts` | normalizeHandle 测试 |
| 新增 | `src/utils/__tests__/classify-error.test.ts` | classifyError 测试 |
| 新增 | `src/utils/__tests__/estimate-cost.test.ts` | estimateCost 测试 |
| 新增 | `src/utils/__tests__/check-account-enabled.test.ts` | checkAccountEnabled 测试（fs/process mock） |
| 新增 | `vitest.config.ts` | testEnvironment: node，最小配置 |
| 修改 | `package.json` | `"test": "vitest run"` + vitest devDep |
| 修改 | `README.md` | .env 说明、NDJSON envelope、export 目录区分、成本公式 |

---

## Section 1: pino redact

### 设计

在 `src/utils/logger.ts` 的 pino 配置中加入：

```typescript
redact: {
  paths: ['authorization', 'token', 'password', 'X_BEARER_TOKEN', '*.token', '*.authorization'],
  censor: '[REDACTED]',
},
```

覆盖范围：
- `authorization`：HTTP 头直传对象（`{ authorization: 'Bearer xxx' }`）
- `X_BEARER_TOKEN`：防止 env 对象被意外 spread 进日志
- `*.token` / `*.authorization`：覆盖任何嵌套对象中的同名字段
- `password`：通用防护

pino `redact` 在序列化阶段运行，不影响 log 级别或结构。

### 完成标准

- `logger.info({ authorization: 'Bearer xxx' }, 'test')` 输出中 `authorization` 值为 `[REDACTED]`
- `X_BEARER_TOKEN` 字段被屏蔽

---

## Section 2: Vitest 单元测试

### 配置

`vitest.config.ts`（最小配置）：

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

`package.json` 新增：
- devDependency: `"vitest": "^2.0.0"`
- script: `"test": "vitest run"`

### 测试文件设计

#### normalize-handle.test.ts

覆盖场景：
- `@Handle` → `handle`（去 @ + 小写）
- `Handle` → `handle`（只小写）
- `handle` → `handle`（已规范化）
- `@UPPER` → `upper`
- 空字符串 → 空字符串

#### estimate-cost.test.ts

覆盖场景：
- 已知 `reads × costPerRead` 精确输出
- 0 reads → 0
- 小数精度

#### classify-error.test.ts

覆盖场景（每个 branch 一个用例）：
- `ApiError(401)` → `logMessage` 含 "invalid or expired"，`errorMessage` = `"auth_failed: token invalid (401)"`
- `ApiError(403)` → `errorMessage` = `"auth_failed: forbidden (403)"`
- `ApiError(404)` with context `{ handle: 'foo' }` → `errorMessage` = `"not_found: handle=foo (404)"`
- `ApiError(429)` → `errorMessage` = `"rate_limit_exceeded (429)"`
- `ApiError(503)` → `errorMessage` = `"server_error: 503"`
- `ApiError(422)` → `errorMessage` = `"api_error: 422"`
- 网络 TypeError（`message: 'fetch failed ENOTFOUND'`）→ `logMessage` 含 "Network error"
- ENOENT Error → `logMessage` 含 "Config file not found"，`errorMessage` 含 "config_error"
- SqliteError（`err.name = 'SqliteError'`）→ `errorMessage` 含 "db_error"
- 普通 Error → `logMessage` = `''`，`errorMessage` = err.message
- 非 Error（string）→ `logMessage` = `''`，`errorMessage` = string

#### check-account-enabled.test.ts

使用 `vi.spyOn(fs, 'readFileSync')` mock 文件读取，`vi.spyOn(process, 'exit')` mock 退出：

覆盖场景：
- `enabled: false` → `process.exit(1)` 被调用
- `enabled: true` → `process.exit` 不被调用
- 账号不在列表中 → `process.exit` 不被调用
- `enabled` 字段缺失 → `process.exit` 不被调用
- handle 带 `@` 前缀（`@foo`）→ 规范化后与配置匹配正确

每个测试用 `beforeEach` / `afterEach` 恢复 spy。

### 完成标准

- `pnpm test` 全部通过
- 所有四个函数的指定分支均有对应测试用例

---

## Section 3: export 命名说明（README only）

行为不变，export 目录结构保持：
- `exports/raw/{handle}/YYYY-MM-DD.ndjson` — 机器可读，每行一个 JSON
- `exports/daily/{handle}/YYYY-MM-DD.md` — 人类可读，markdown 列表

只在 README 中补充说明。

---

## Section 4: README 更新

### 补充内容

1. **`.env` 说明**：

```
X_BEARER_TOKEN=Bearer <your_token>
DATABASE_URL=file:./data/market-watcher.sqlite  # 默认值，可省略
```

2. **NDJSON envelope 字段**（`exports/raw/{handle}/*.ndjson` 每行格式）：

```json
{
  "tweet_id": "...",
  "author_handle": "...",
  "created_at": "...",
  "text": "...",
  "url": "...",
  "type": "tweet|retweet|reply|quoted",
  "referenced_tweet_id": null,
  "public_metrics": { "like_count": 0, "reply_count": 0, "retweet_count": 0, "quote_count": 0, "bookmark_count": 0, "impression_count": 0 },
  "raw_json": { ... }
}
```

3. **export 目录区分**：`exports/raw/` 机器可读（ndjson），`exports/daily/` 人类可读（markdown）。

4. **成本公式修正**：`estimatedCostUsd = totalEstimatedPostReads × estimatedPostReadCost`，参数来自 `config/fetch-policy.json`。

### 完成标准

- README 中有 `.env` 示例
- NDJSON envelope 字段列出
- export 两个目录的用途各有说明
- 成本公式与实际代码一致
