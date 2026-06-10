# Phase 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成四个 P2 工程收口项：pino redact、Vitest 单测（4 个 utils 函数）、README 文档补全。

**Architecture:** 纯配置变更 + 工具函数单元测试 + 文档更新。无 schema 变更，无新 service，无新 job。测试只覆盖 `src/utils/` 中的纯函数和可 mock 函数。

**Tech Stack:** TypeScript 5.x、tsx、pino 9.x、Vitest 2.x

**Spec:** `docs/superpowers/specs/2026-06-10-phase9-design.md`

---

### Task 1: pino redact — 防止 token 泄漏

**Files:**
- Modify: `src/utils/logger.ts`

- [ ] **Step 1: 加入 redact 配置**

将 `src/utils/logger.ts` 改为：

```typescript
import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  redact: {
    paths: [
      'authorization',
      'token',
      'password',
      'X_BEARER_TOKEN',
      '*.token',
      '*.authorization',
      '*.X_BEARER_TOKEN',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
  transport: process.stdout.isTTY
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
rtk tsc --noEmit
```

期望：无输出（0 errors）。

- [ ] **Step 3: Commit**

```bash
git add src/utils/logger.ts
git commit -m "feat: add pino redact to prevent token leakage in logs"
```

---

### Task 2: Vitest 基础设施

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: 在 package.json 加入 vitest devDependency 和 test script**

在 `package.json` 的 `"devDependencies"` 中加入：
```json
"vitest": "^2.0.0"
```

在 `"scripts"` 中加入：
```json
"test": "vitest run"
```

完整 `package.json` scripts 段应为：
```json
"scripts": {
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx src/db/migrate.ts",
  "x:resolve": "tsx src/jobs/resolve-account.ts",
  "x:backfill": "tsx src/jobs/backfill-account.ts",
  "x:sync": "tsx src/jobs/sync-account.ts",
  "x:export:daily": "tsx src/jobs/export-daily-raw.ts",
  "x:status": "tsx src/jobs/status.ts",
  "test": "vitest run"
},
```

- [ ] **Step 2: 安装依赖**

```bash
pnpm install
```

期望：vitest 出现在 `node_modules/.bin/vitest`。

- [ ] **Step 3: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: 验证 TypeScript 编译通过**

```bash
rtk tsc --noEmit
```

期望：无输出。

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: add Vitest 2.x as test framework"
```

---

### Task 3: normalizeHandle 单测

**Files:**
- Create: `src/utils/__tests__/normalize-handle.test.ts`

`normalizeHandle` 实现（`cli.ts:18-20`）：只去前导 `@`，不做 lower-case。

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeHandle } from '../cli';

describe('normalizeHandle', () => {
  it('strips leading @ and preserves case', () => {
    expect(normalizeHandle('@Handle')).toBe('Handle');
  });

  it('returns handle unchanged when no @ prefix', () => {
    expect(normalizeHandle('Handle')).toBe('Handle');
  });

  it('returns lowercase handle unchanged', () => {
    expect(normalizeHandle('handle')).toBe('handle');
  });

  it('strips @ from all-uppercase handle', () => {
    expect(normalizeHandle('@UPPER')).toBe('UPPER');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeHandle('')).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试，确认全部通过**

```bash
pnpm test -- normalize-handle
```

期望：`5 passed`，0 failed。

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/normalize-handle.test.ts
git commit -m "test: add normalizeHandle unit tests"
```

---

### Task 4: estimateCost 单测

**Files:**
- Create: `src/utils/__tests__/estimate-cost.test.ts`

`estimateCost` 签名（`cost.ts:7`）：`estimateCost(postReads, userReads, postCostPerUnit, userCostPerUnit): { postReads, userReads, totalUsd }`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { estimateCost } from '../cost';

describe('estimateCost', () => {
  it('returns correct object for normal input', () => {
    const result = estimateCost(100, 1, 0.0001, 0.001);
    expect(result).toEqual({
      postReads: 100,
      userReads: 1,
      totalUsd: 0.011,
    });
  });

  it('returns all zeros for zero reads', () => {
    const result = estimateCost(0, 0, 0.0001, 0.001);
    expect(result).toEqual({ postReads: 0, userReads: 0, totalUsd: 0 });
  });

  it('correctly computes with only post reads', () => {
    const result = estimateCost(50, 0, 0.002, 0.001);
    expect(result.totalUsd).toBe(0.1);
    expect(result.userReads).toBe(0);
  });

  it('passes through postReads and userReads values unchanged', () => {
    const result = estimateCost(42, 7, 0.001, 0.01);
    expect(result.postReads).toBe(42);
    expect(result.userReads).toBe(7);
  });
});
```

- [ ] **Step 2: 运行测试，确认全部通过**

```bash
pnpm test -- estimate-cost
```

期望：`4 passed`，0 failed。

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/estimate-cost.test.ts
git commit -m "test: add estimateCost unit tests"
```

---

### Task 5: classifyError 单测

**Files:**
- Create: `src/utils/__tests__/classify-error.test.ts`

`ApiError` 构造函数签名（`x-api-client.ts:10-18`）：`new ApiError(status: number, body: string, path: string)`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { classifyError } from '../classify-error';
import { ApiError } from '../../clients/x-api-client';

describe('classifyError', () => {
  describe('ApiError cases', () => {
    it('401 → auth_failed token invalid', () => {
      const result = classifyError(new ApiError(401, 'Unauthorized', '/users/by/username/foo'));
      expect(result.logMessage).toContain('invalid or expired');
      expect(result.errorMessage).toBe('auth_failed: token invalid (401)');
    });

    it('403 → auth_failed forbidden', () => {
      const result = classifyError(new ApiError(403, 'Forbidden', '/users/foo'));
      expect(result.errorMessage).toBe('auth_failed: forbidden (403)');
    });

    it('404 with handle context → not_found with handle', () => {
      const result = classifyError(new ApiError(404, 'Not Found', '/users/by/username/foo'), { handle: 'foo' });
      expect(result.errorMessage).toBe('not_found: handle=foo (404)');
      expect(result.logMessage).toContain('@foo');
    });

    it('404 without context → not_found with unknown', () => {
      const result = classifyError(new ApiError(404, 'Not Found', '/users/by/username/foo'));
      expect(result.errorMessage).toBe('not_found: handle=unknown (404)');
    });

    it('429 → rate_limit_exceeded', () => {
      const result = classifyError(new ApiError(429, 'Too Many Requests', '/users/foo/tweets'));
      expect(result.errorMessage).toBe('rate_limit_exceeded (429)');
    });

    it('503 → server_error 503', () => {
      const result = classifyError(new ApiError(503, 'Service Unavailable', '/users/foo/tweets'));
      expect(result.errorMessage).toBe('server_error: 503');
    });

    it('422 → api_error 422', () => {
      const result = classifyError(new ApiError(422, 'Unprocessable', '/users/foo/tweets'));
      expect(result.errorMessage).toBe('api_error: 422');
    });
  });

  describe('network TypeError', () => {
    it('ENOTFOUND → network_error with logMessage', () => {
      const err = new TypeError('fetch failed ENOTFOUND api.twitter.com');
      const result = classifyError(err);
      expect(result.logMessage).toContain('Network error');
      expect(result.errorMessage).toContain('network_error');
    });
  });

  describe('ENOENT', () => {
    it('ENOENT → config_error', () => {
      const err = Object.assign(new Error('ENOENT: no such file config/accounts.json'), { code: 'ENOENT' });
      const result = classifyError(err);
      expect(result.logMessage).toContain('Config file not found');
      expect(result.errorMessage).toContain('config_error');
    });
  });

  describe('SqliteError', () => {
    it('SqliteError → db_error', () => {
      const err = Object.assign(new Error('UNIQUE constraint failed'), { name: 'SqliteError' });
      const result = classifyError(err);
      expect(result.logMessage).toContain('Database error');
      expect(result.errorMessage).toContain('db_error');
    });
  });

  describe('generic fallback', () => {
    it('plain Error → empty logMessage, uses err.message', () => {
      const result = classifyError(new Error('something unexpected'));
      expect(result.logMessage).toBe('');
      expect(result.errorMessage).toBe('something unexpected');
    });

    it('non-Error string → empty logMessage, stringified', () => {
      const result = classifyError('raw string error');
      expect(result.logMessage).toBe('');
      expect(result.errorMessage).toBe('raw string error');
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认全部通过**

```bash
pnpm test -- classify-error
```

期望：`11 passed`，0 failed。

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/classify-error.test.ts
git commit -m "test: add classifyError unit tests"
```

---

### Task 6: checkAccountEnabled 单测

**Files:**
- Create: `src/utils/__tests__/check-account-enabled.test.ts`

`checkAccountEnabled` 实现（`cli.ts:37-48`）：读 `config/accounts.json`，若账号 `enabled === false` 则 `process.exit(1)`。用 sentinel-throw 策略 mock `process.exit`，使测试不会真正退出且不会让函数继续执行。

- [ ] **Step 1: 创建测试文件**

```typescript
import fs from 'fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkAccountEnabled } from '../cli';

const makeConfig = (accounts: Array<{ handle: string; enabled?: boolean }>) =>
  JSON.stringify({ accounts });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkAccountEnabled', () => {
  it('calls process.exit(1) when account is disabled', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo', enabled: false }]) as any,
    );
    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit called with ${code}`);
    });

    expect(() => checkAccountEnabled('foo')).toThrow('process.exit called with 1');
  });

  it('does not exit when account is enabled', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo', enabled: true }]) as any,
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => checkAccountEnabled('foo')).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when account is not in config', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'other', enabled: true }]) as any,
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => checkAccountEnabled('foo')).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when enabled field is missing', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo' }]) as any,
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => checkAccountEnabled('foo')).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('normalizes @ prefix in config handle — config has @foo, input is foo', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: '@foo', enabled: false }]) as any,
    );
    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit called with ${code}`);
    });

    // config entry written as '@foo'; normalizeHandle('@foo') === 'foo' matches input
    expect(() => checkAccountEnabled('foo')).toThrow('process.exit called with 1');
  });
});
```

- [ ] **Step 2: 运行测试，确认全部通过**

```bash
pnpm test -- check-account-enabled
```

期望：`5 passed`，0 failed。

- [ ] **Step 3: 运行完整测试套件，确认无回归**

```bash
pnpm test
```

期望：所有测试通过（normalize-handle + estimate-cost + classify-error + check-account-enabled）。

- [ ] **Step 4: Commit**

```bash
git add src/utils/__tests__/check-account-enabled.test.ts
git commit -m "test: add checkAccountEnabled unit tests with sentinel-throw mock"
```

---

### Task 7: README 更新

**Files:**
- Modify: `README.md`

**改动点 1：`.env` 示例**

在 README 第 27 行 `cp .env.example .env` 和 `# 编辑 .env，填入 X_BEARER_TOKEN` 之后，加入完整示例：

将这段：
```markdown
复制并填写环境变量：

```bash
cp .env.example .env
# 编辑 .env，填入 X_BEARER_TOKEN
```
```

替换为：
```markdown
复制并填写环境变量：

```bash
cp .env.example .env
```

`.env` 示例：

```
X_BEARER_TOKEN=<your_bearer_token>
DATABASE_URL=file:./data/market-watcher.sqlite
```

> `X_BEARER_TOKEN` 填纯 token，不加 `Bearer ` 前缀——HTTP 客户端会自动拼接。
```

**改动点 2：export 输出文件说明 + NDJSON envelope**

将这段（第 109-111 行）：
```markdown
输出文件：
- `exports/raw/<handle>/<date>.ndjson` — 每行一条原始 X API JSON
- `exports/daily/<handle>/<date>.md` — Markdown 列表格式
```

替换为：
```markdown
输出文件：
- `exports/raw/<handle>/<date>.ndjson` — 机器可读，每行一条 envelope JSON
- `exports/daily/<handle>/<date>.md` — 人类可读，Markdown 列表格式

每行 ndjson 的 envelope 结构：

```json
{
  "tweet_id": "...",
  "author_handle": "...",
  "created_at": "2026-06-09T14:35:00.000Z",
  "text": "...",
  "url": "https://x.com/handle/status/...",
  "type": "tweet",
  "referenced_tweet_id": null,
  "public_metrics": {
    "like_count": 0,
    "reply_count": 0,
    "retweet_count": 0,
    "quote_count": 0,
    "bookmark_count": 0,
    "impression_count": 0
  },
  "raw_json": { ... }
}
```
```

**改动点 3：status 输出示例**

将这段（第 119-130 行）：
```markdown
示例输出：

```
Account:   @example_handle
User ID:   123456789
Posts:     1842 total
Backfill:  completed ✓
Latest:    1799xxxxxxxxxxxxxxx
Oldest:    1700xxxxxxxxxxxxxxx

Last run:  sync · success · 3 inserted · 2026-06-09T14:35:00.000Z
```
```

替换为：
```markdown
示例输出：

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
```

**改动点 4：成本保护公式**

将这段（第 149-151 行）：
```markdown
每次 API 调用前预估费用：`(pagesCount + 1) × maxResultsPerPage × estimatedPostReadCost`。超过 `maxEstimatedCostPerRun` 时自动停止，run 状态记录为 `stopped_by_cost_limit`。
```

替换为：
```markdown
每次 API 调用前预估费用，按 job 类型区分：

- `x:resolve`：`estimatedCostUsd = 1 × estimatedUserReadCost`
- `x:backfill` / `x:sync`：`estimatedCostUsd = totalEstimatedPostReads × estimatedPostReadCost`

参数均来自 `config/fetch-policy.json`。超过 `maxEstimatedCostPerRun` 时自动停止，run 状态记录为 `stopped_by_cost_limit`。
```

- [ ] **Step 1: 应用上述四处改动到 README.md**

- [ ] **Step 2: 阅读修改后的 README，确认四处改动均已正确应用，无遗漏或格式错误**

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README — env example, NDJSON envelope, status output, cost formula"
```

---

## 验收检查

所有任务完成后，运行：

```bash
pnpm test
rtk tsc --noEmit
```

期望：全部测试通过，TypeScript 无编译错误。
