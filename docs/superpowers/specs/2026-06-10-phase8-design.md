# Phase 8 Design: P1 Closure Fixes

## Goal

修复四个 P1 稳定性问题，完成第一阶段全部收口：
1. `enabled` 账号配置真正生效（disabled 账号硬拦截）
2. 错误分类与错误文案（新增 `classify-error.ts` 统一处理）
3. `failed` 路径补全运行统计字段
4. `backfillCompleted` 保护 + 边界行为修正

---

## Scope

- 不改 schema / migrate.ts
- 不做 `label` 同步到 DB（无目标字段，风险升高，超出本阶段范围）
- 不为"跳过已完成 backfill"创建 run 记录
- export 无数据日期：只改 log level，不改行为

---

## Architecture

修改范围：
- `src/utils/cli.ts` — 新增 `checkAccountEnabled()`
- `src/utils/classify-error.ts` — 新增错误分类工具（新文件）
- `src/clients/x-api-client.ts` — `Max retries exceeded` 改为抛出可识别的错误
- `src/jobs/resolve-account.ts` — 接入 `checkAccountEnabled` + `classifyError`
- `src/jobs/backfill-account.ts` — 接入 `checkAccountEnabled` + `classifyError` + 统计补全 + backfillCompleted 保护
- `src/jobs/sync-account.ts` — 接入 `checkAccountEnabled` + `classifyError` + 统计补全
- `src/jobs/export-daily-raw.ts` — `logger.info` → `logger.warn`（无数据日期）

---

## File Map

| 操作 | 文件 | 改动内容 |
|---|---|---|
| 修改 | `src/utils/cli.ts` | 新增 `checkAccountEnabled(handle)` |
| 新增 | `src/utils/classify-error.ts` | `classifyError(err, handle?)` |
| 修改 | `src/clients/x-api-client.ts` | retry 耗尽时抛出 `ApiError` 而非普通 Error |
| 修改 | `src/jobs/resolve-account.ts` | `checkAccountEnabled` + `classifyError` |
| 修改 | `src/jobs/backfill-account.ts` | `checkAccountEnabled` + `classifyError` + failed 统计 + `backfillCompleted` 延后 |
| 修改 | `src/jobs/sync-account.ts` | `checkAccountEnabled` + `classifyError` + failed 统计 |
| 修改 | `src/jobs/export-daily-raw.ts` | `logger.info` → `logger.warn`（no posts） |

---

## Section 1: 账号配置闭环

### 设计

在 `src/utils/cli.ts` 新增函数，读取 `accounts.json` 检查 handle 的 `enabled` 状态：

```typescript
export function checkAccountEnabled(handle: string): void {
  const accountsPath = path.resolve('config/accounts.json');
  const config: { accounts: Array<{ handle: string; enabled: boolean }> } =
    JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  const account = config.accounts.find(
    a => normalizeHandle(a.handle) === handle,
  );
  if (account && account.enabled === false) {
    console.error(`Account @${handle} is disabled in config/accounts.json — aborting`);
    process.exit(1);
  }
}
```

规则：
- handle 在配置中且 `enabled: false` → 拦截（`process.exit(1)`）
- handle 不在配置中 → 不拦截（允许外部账号）
- handle 在配置中且 `enabled: true`（或字段缺失）→ 不拦截

三个会触发 API 抓取的 job（resolve-account / backfill-account / sync-account）在 `resolveHandle()` 之后紧接着调用。export-daily-raw 和 status 是只读操作，不接入（这两个 job 即使对 disabled 账号执行也无副作用）：

```typescript
const handle = resolveHandle();
checkAccountEnabled(handle);
```

`fs` 和 `path` 已在 `cli.ts` 中导入，无新依赖。

### 完成标准

- `enabled: false` 的账号执行 resolve / backfill / sync 均 exit 1 并打印明确原因
- export / status 不受 enabled 状态影响（只读，无需拦截）
- 不在配置中的账号不受影响
- `--handle @xxx` 和 `--handle xxx` 的规范化不影响判断（compare 时统一去掉 `@`）

---

## Section 2: 错误分类

### x-api-client.ts 修改

将 retry 耗尽时的普通 `Error` 改为 `ApiError`（status 429），使 classify 可以识别：

```typescript
// 原来
throw new Error(`Max retries exceeded for ${path}`);

// 改为
throw new ApiError(429, 'Max retries exceeded', path);
```

理由：retry 耗尽必然是 429 反复触发所致，用 ApiError(429) 语义准确，且 classify 无需额外 pattern matching。

### classify-error.ts 设计

```typescript
import { ApiError } from '../clients/x-api-client';

export function classifyError(
  err: unknown,
  context?: { handle?: string },
): { logMessage: string; errorMessage: string } {
  if (err instanceof ApiError) {
    const { status, path } = err;
    if (status === 401) {
      return {
        logMessage: 'X_BEARER_TOKEN is invalid or expired',
        errorMessage: 'auth_failed: token invalid (401)',
      };
    }
    if (status === 403) {
      return {
        logMessage: 'Access forbidden — check X app permissions',
        errorMessage: 'auth_failed: forbidden (403)',
      };
    }
    if (status === 404) {
      const handle = context?.handle ?? 'unknown';
      return {
        logMessage: `Account not found or not accessible: @${handle}`,
        errorMessage: `not_found: handle=${handle} (404)`,
      };
    }
    if (status === 429) {
      return {
        logMessage: 'Rate limit exceeded after retries',
        errorMessage: 'rate_limit_exceeded (429)',
      };
    }
    if (status >= 500) {
      return {
        logMessage: `X API server error ${status} on ${path}`,
        errorMessage: `server_error: ${status}`,
      };
    }
    return {
      logMessage: `X API error ${status} on ${path}`,
      errorMessage: `api_error: ${status}`,
    };
  }

  if (err instanceof TypeError && /fetch|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(err.message)) {
    return {
      logMessage: 'Network error — check connectivity',
      errorMessage: `network_error: ${err.message}`,
    };
  }

  // 配置文件缺失：当前 job 中由配置读取（accounts.json / fetch-policy.json）触发的 ENOENT 归为 config_error
  if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    return {
      logMessage: `Config file not found: ${err.message}`,
      errorMessage: `config_error: ${err.message}`,
    };
  }

  // 数据库错误（better-sqlite3 抛出的错误名称为 'SqliteError'）
  if (err instanceof Error && err.name === 'SqliteError') {
    return {
      logMessage: `Database error: ${err.message}`,
      errorMessage: `db_error: ${err.message}`,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    logMessage: '',
    errorMessage: message,
  };
}
```

### 各 job catch 块模式

```typescript
} catch (err) {
  const { logMessage, errorMessage } = classifyError(err, { handle });
  if (logMessage) logger.error({ handle }, logMessage);

  if (runId !== undefined) {
    finishRun(runId, {
      status: 'failed',
      finishedAt: nowISO(),
      errorMessage,
      // backfill / sync 另补统计字段（见 Section 3）
    });
  }

  logger.error({ err }, 'xxx-job failed');
  process.exit(1);
}
```

`logger.error({ err }, ...)` 保留作为兜底，确保 stack trace 可见。`if (logMessage) logger.error({ handle }, logMessage)` 带上 handle 上下文，方便定位是哪个账号触发的错误。

### 完成标准

- 401 / 403 / 404 / 429 / 5xx 各有明确 `logMessage`
- 网络错误、配置文件缺失、数据库错误各有明确 `logMessage`
- `errorMessage` 写入 `fetch_runs.error_message`，格式统一（`error_type: detail`）
- 不在日志中打印 `X_BEARER_TOKEN`

---

## Section 3: failed 路径统计补全

### 设计

backfill 和 sync 需要将以下变量从 `try` 块内**提升**到 `try` 块外（与 `runId` 同级），使 catch 可访问：

```typescript
let runId: number | undefined = undefined;
let p: {
  estimatedPostReadCost: number;
  // 其余字段省略
} | undefined = undefined;
let pagesCount = 0;
let insertedPosts = 0;
let duplicatedPosts = 0;
let totalEstimatedPostReads = 0;

try {
  // 读取 policy 后赋值给 p
  p = policy.default;
  // ... 其余逻辑（不再在 try 内重新声明上述变量）
} catch (err) {
  const { logMessage, errorMessage } = classifyError(err, { handle });
  if (logMessage) logger.error({ handle }, logMessage);

  if (runId !== undefined) {
    finishRun(runId, {
      status: 'failed',
      finishedAt: nowISO(),
      errorMessage,
      requestedPages: pagesCount,
      fetchedPosts: insertedPosts + duplicatedPosts,
      insertedPosts,
      duplicatedPosts,
      estimatedPostReads: totalEstimatedPostReads,
      estimatedCostUsd: p != null
        ? totalEstimatedPostReads * p.estimatedPostReadCost
        : undefined,
    });
  }

  logger.error({ err }, 'xxx-job failed');
  process.exit(1);
}
```

注意：`pagesCount`、`insertedPosts`、`duplicatedPosts`、`totalEstimatedPostReads` 当前声明在 `try` 块内部，实现时必须将它们提升到 `try` 之外。`p` 如果在读取 policy 之前就报错（`fs.readFileSync` 失败），则为 `undefined`，用 `p != null` 保护。

resolve-account 的 catch 路径不加统计字段（无分页）。

### 完成标准

- backfill / sync 失败时 `fetch_runs` 记录中包含截至失败时的 `insertedPosts`、`estimatedPostReads` 等
- policy 加载失败时 catch 不报额外错误

---

## Section 4: backfillCompleted 保护 + 边界行为

### backfillCompleted 延后写入

当前：在 while 循环内 `updateCursor` 时写 `backfillCompleted: 1`。

修复：

1. 循环内不再写 `backfillCompleted`，改为在循环外用布尔变量跟踪：

```typescript
let isBackfillComplete = false;

while (true) {
  // ...
  const isLastPage = (tweets.length > 0 && !meta?.next_token) || meta?.result_count === 0;
  const cursorPatch: Parameters<typeof updateCursor>[1] = {
    lastPaginationToken: meta?.next_token ?? null,
    oldestTweetId: meta?.oldest_id ?? undefined,
    // 不再有 backfillCompleted
    updatedAt: pageNow,
  };
  // ... 其余 cursor 逻辑不变
  if (isLastPage) isBackfillComplete = true;
  // ...
}
```

2. 在 `finishRun(success)` **之前**写入：

```typescript
if (isBackfillComplete) {
  updateCursor(handle, { backfillCompleted: 1, updatedAt: nowISO() });
}

finishRun(runId, { status: 'success', ... });
```

语义：`backfillCompleted` 写入失败会抛出异常，被外层 catch 捕获并将 run 标记为 failed，cursor 也不会被标记完成。这是优先级选择：**避免重复 backfill** 比 **run/cursor 完全原子一致** 更重要——cursor 完成而 run 未记录 success 只是统计上的小缺口；而 run=success 但 cursor 未标完成，会导致下次重跑整个 backfill，代价更高。

### export 无数据日期

```typescript
// 原来
logger.info({ handle, date }, 'No posts for this date');

// 改为
logger.warn({ handle, date }, 'No posts for this date — export skipped');
```

### backfill 已完成时的 log

```typescript
// 原来
logger.info({ handle }, 'Backfill already completed, nothing to do');

// 改为
logger.info({ handle }, 'Backfill already completed — skipping');
```

行为不变，无 run 记录创建。

### 完成标准

- `fetch_cursors.backfill_completed` 只在 backfill 数据抓取逻辑全部成功完成后写入，中途失败时不写入
- 中途失败的 backfill run 不会留下错误的 `backfill_completed = 1`
- `finishRun` 失败（极小概率）时 cursor 已标完成，下次运行会正确跳过（不重跑）
- export 无数据时日志 level 为 warn，易于识别
