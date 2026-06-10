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
| 修改 | `README.md` | .env 说明、NDJSON envelope、export 目录区分、成本公式、status 示例 |

---

## Section 1: pino redact

### 设计

在 `src/utils/logger.ts` 的 pino 配置中加入：

```typescript
redact: {
  paths: ['authorization', 'token', 'password', 'X_BEARER_TOKEN', '*.token', '*.authorization', '*.X_BEARER_TOKEN', '*.password'],
  censor: '[REDACTED]',
},
```

覆盖范围：
- `authorization`：HTTP 头直传对象（`{ authorization: 'Bearer xxx' }`）
- `X_BEARER_TOKEN`：防止 env 对象被意外 spread 进日志
- `*.X_BEARER_TOKEN`：覆盖嵌套对象中的 X_BEARER_TOKEN（如 `{ env: { X_BEARER_TOKEN: ... } }`）
- `*.token` / `*.authorization`：覆盖任何嵌套对象中的同名字段
- `password` / `*.password`：顶层与嵌套对象中的 password 字段

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

`normalizeHandle` 只去前导 `@`，不做 lower-case（`cli.ts:19`）。

覆盖场景：
- `@Handle` → `Handle`（去 @，保留大小写）
- `Handle` → `Handle`（无 @，原样返回）
- `handle` → `handle`（已规范化）
- `@UPPER` → `UPPER`
- 空字符串 → 空字符串

#### estimate-cost.test.ts

`estimateCost(postReads, userReads, postCostPerUnit, userCostPerUnit)` 返回 `{ postReads, userReads, totalUsd }`（见 `cost.ts`）。

覆盖场景：
- 正常输入：`estimateCost(100, 1, 0.0001, 0.001)` → `{ postReads: 100, userReads: 1, totalUsd: 0.011 }`
- 全 0：`estimateCost(0, 0, 0.0001, 0.001)` → `{ postReads: 0, userReads: 0, totalUsd: 0 }`
- 只有 postReads：`estimateCost(50, 0, 0.002, 0.001)` → `totalUsd: 0.1`，`userReads: 0`
- 输入原样透传：返回对象中 `postReads` 和 `userReads` 与入参一致

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

使用 `vi.spyOn(fs, 'readFileSync')` mock 文件读取。`process.exit` 使用 sentinel 抛出策略：

```typescript
vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit called with ${code}`);
});
```

这样 disabled 分支会抛出 sentinel error，测试可用 `expect(...).toThrow('process.exit called with 1')` 断言，而不会让测试进程真正退出，也不会让函数在 exit mock 后继续执行。

覆盖场景：
- `enabled: false` → 抛出含 "process.exit called with 1" 的 error
- `enabled: true` → 不抛出
- 账号不在列表中 → 不抛出
- `enabled` 字段缺失 → 不抛出
- handle 带 `@` 前缀（`@foo`）传入，配置里为 `foo` → 不抛出（规范化后匹配）

每个测试用 `afterEach(() => vi.restoreAllMocks())` 恢复 spy。

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
X_BEARER_TOKEN=<your_token>
DATABASE_URL=file:./data/market-watcher.sqlite  # 默认值，可省略
```

注意：`X_BEARER_TOKEN` 填纯 token，不加 `Bearer ` 前缀——客户端会自动拼接（`x-api-client.ts:37`）。

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

4. **成本公式修正**（区分两种路径）：

   - `resolve`：`estimatedCostUsd = 1 × estimatedUserReadCost`（每次 1 次 user read，参数来自 `fetch-policy.json`）
   - `backfill` / `sync`：`estimatedCostUsd = totalEstimatedPostReads × estimatedPostReadCost`（参数来自 `fetch-policy.json`）

   原 README 公式 `(pagesCount + 1) × maxResultsPerPage × estimatedPostReadCost` 与实现不符，一并替换。

5. **status 输出示例更新**（`README.md` 第 119–130 行）：当前示例缺少 `cost` 和 `last err` 字段，更新为：

```
Account:   @example_handle
User ID:   123456789
Posts:     1842 total
Backfill:  completed ✓
Latest:    1799xxxxxxxxxxxxxxx (2026-06-09T14:35:00.000Z)
Oldest:    1700xxxxxxxxxxxxxxx

Last run:  sync · success · 3 inserted · 2026-06-09T14:35:00.000Z · $0.00
Last err:  n/a
```

### 完成标准

- README 中有 `.env` 示例，且注明不加 `Bearer ` 前缀
- NDJSON envelope 字段列出
- export 两个目录的用途各有说明
- 成本公式区分 resolve 与 backfill/sync，与实际代码一致
- status 示例字段顺序与 `status.ts:53` 一致（`inserted · startedAt · $cost`），cost 格式为 `$x.xx`
- status 示例包含 `Last err:` 行
