# Phase 7a Design: Closure Fixes (Low-Risk)

## Goal

修复三个 P0 低风险问题，让 market-watcher-core 进入稳定可信状态：
1. Handle 输入规范化（统一去掉前导 `@`）
2. Cursor 时间边界字段写入（`latestTweetCreatedAt` / `oldestTweetCreatedAt`）
3. Status 输出增强（展示时间范围、成本、最近错误）

---

## Scope

本阶段只保证「新输入统一规范化」，不处理旧库中已有的带 `@` 前缀数据迁移。旧数据清理可在 Phase 7b 或单独补充任务中处理。

---

## Architecture

修改范围：
- `src/utils/cli.ts` — handle 规范化
- `src/jobs/backfill-account.ts` — cursor 时间写入
- `src/jobs/sync-account.ts` — cursor 时间写入
- `src/jobs/status.ts` — 输出增强
- `src/services/run-log-service.ts` — 新增 `getLatestFailedRun()`

`cursor-service.ts` 的 `updateCursor(handle, patch)` 已支持 partial patch（`updatedAt` 必填，其余可选），`fetch_cursors` 表已有目标字段，无需改 schema。

---

## File Map

| 操作 | 文件 | 改动内容 |
|---|---|---|
| 修改 | `src/utils/cli.ts` | 新增 `normalizeHandle()`，在 `resolveHandle()` 所有出口应用 |
| 修改 | `src/jobs/backfill-account.ts` | `updateCursor` 调用补入 `latestTweetCreatedAt`（首页，非空时）和 `oldestTweetCreatedAt`（每页，非空时） |
| 修改 | `src/jobs/sync-account.ts` | `updateCursor` 调用补入 `latestTweetCreatedAt`（首页第一条，非空时） |
| 修改 | `src/jobs/status.ts` | 输出补充 created_at 时间范围、成本、最近失败错误 |
| 修改 | `src/services/run-log-service.ts` | 新增 `getLatestFailedRun(handle)` |

---

## Section 1: Handle 规范化

### 设计

在 `src/utils/cli.ts` 新增纯函数，在 `resolveHandle()` 所有出口包裹调用：

```typescript
export function normalizeHandle(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle;
}

export function resolveHandle(): string {
  const fromArg = getArg('handle');
  if (fromArg) return normalizeHandle(fromArg);

  const accountsPath = path.resolve('config/accounts.json');
  const accounts: { accounts: Array<{ handle: string; enabled: boolean }> } =
    JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  const first = accounts.accounts.find(a => a.enabled);
  if (!first) {
    console.error('No enabled account found in config/accounts.json and --handle not provided');
    process.exit(1);
  }
  return normalizeHandle(first.handle);
}
```

`fs` 和 `path` 已在现有 `cli.ts` 中导入，无新依赖。

### 完成标准

- `--handle @aleabitoreddit` 和 `--handle aleabitoreddit` 行为完全一致
- 内部流转、数据库主键、导出目录均不含前导 `@`
- 展示层（status 输出 `@${handle}`）保留 `@` 前缀

---

## Section 2: Cursor 时间边界字段写入

### 前提

X API timeline 端点返回顺序为 `created_at` 降序（newest first）。因此 `tweets[0]` 是最新推文，`tweets[tweets.length - 1]` 是最早推文，无需额外排序。

### 设计

**backfill-account.ts** 写入时机：

- **首页且非空**：写入 `latestTweetCreatedAt = tweets[0].created_at`
- **每页且非空**：写入 `oldestTweetCreatedAt = tweets[tweets.length - 1].created_at`
- `updatedAt` 所有调用均补入 `nowISO()`（从 `../utils/date` 导入）

```typescript
// 每页 updateCursor 调用示例（首页）
if (isFirstPage && tweets.length > 0) {
  updateCursor(handle, {
    latestTweetId: newestId,
    latestTweetCreatedAt: tweets[0].created_at,
    updatedAt: nowISO(),
  });
}

// 每页更新 oldest（每页非空时写入）
if (tweets.length > 0) {
  updateCursor(handle, {
    oldestTweetId: oldestId,
    oldestTweetCreatedAt: tweets[tweets.length - 1].created_at,
    lastPaginationToken: nextToken ?? null,
    updatedAt: nowISO(),
  });
}
```

> 实现时可将首页和每页合并为一次 `updateCursor` 调用以减少写入次数，以上仅说明逻辑，不强制两次写。

**sync-account.ts** 写入时机：

- sync 完成后的原子 cursor 更新，仅当首页非空时补入 `latestTweetCreatedAt`

```typescript
// sync 原子 cursor 更新（已有 latestTweetId 写入，补充 createdAt）
if (firstPageTweets.length > 0) {
  updateCursor(handle, {
    latestTweetId: newestId,
    latestTweetCreatedAt: firstPageTweets[0].created_at,
    updatedAt: nowISO(),
  });
}
```

### 完成标准

- backfill 完成后，`fetch_cursors` 中两个时间字段均不为 null
- sync 每次成功且有新推文后，`latestTweetCreatedAt` 更新
- 空页时不尝试读取 `tweets[0]`，不写时间字段
- 值来自 X API 原始 `tweet.created_at`（ISO 8601 格式）

---

## Section 3: Status 输出增强

### 新增服务函数

在 `src/services/run-log-service.ts` 新增：

```typescript
export function getLatestFailedRun(handle: string) {
  return db
    .select()
    .from(fetchRuns)
    .where(and(eq(fetchRuns.accountHandle, handle), ne(fetchRuns.status, 'success')))
    .orderBy(desc(fetchRuns.id))
    .limit(1)
    .get();
}
```

需要从 `drizzle-orm` 补充导入 `and`、`ne`。

### Status 输出格式

```
Account:   @handle
User ID:   123456789
Posts:     1842 total
Backfill:  completed ✓
Latest:    1799xxx  (2026-06-09T14:32:00.000Z)
Oldest:    1700xxx  (2025-01-01T08:00:00.000Z)

Last run:  sync · success · 3 inserted · 2026-06-09T14:35:00.000Z · $0.01
Last err:  n/a
```

实现细节：
- 时间格式：直接显示 `cursor.latestTweetCreatedAt`（原始 ISO）；`null` 时省略括号部分
- 成本：`'$' + estimatedCostUsd.toFixed(2)`；`null` 时省略 `·` 及成本部分
- `Last err`：调用 `getLatestFailedRun(handle)`，显示其 `errorMessage`；无失败 run 时显示 `n/a`
- `Last err` 行：仅在 `latestRun` 存在时输出（无任何 run 时不输出此行）

### 完成标准

- 可一眼判断数据覆盖时间范围
- 可一眼判断上次 run 成本
- `Last err` 显示最近一次失败 run 的错误信息（而非最新 run 的 errorMessage）
