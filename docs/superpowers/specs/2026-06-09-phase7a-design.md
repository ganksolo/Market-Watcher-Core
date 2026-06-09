# Phase 7a Design: Closure Fixes (Low-Risk)

## Goal

修复三个 P0 低风险问题，让 market-watcher-core 进入稳定可信状态：
1. Handle 输入规范化（统一去掉前导 `@`）
2. Cursor 时间边界字段写入（`latestTweetCreatedAt` / `oldestTweetCreatedAt`）
3. Status 输出增强（展示时间范围、成本、最近错误）

---

## Architecture

所有修改局限于 `src/utils/cli.ts`、`src/jobs/backfill-account.ts`、`src/jobs/sync-account.ts`、`src/jobs/status.ts` 四个文件。`cursor-service.ts` 的 `updateCursor(handle, patch)` 已支持 partial patch，`fetch_cursors` 表已有目标字段，无需改 service 层或 schema。

---

## File Map

| 操作 | 文件 | 改动内容 |
|---|---|---|
| 修改 | `src/utils/cli.ts` | 新增 `normalizeHandle()`，在 `resolveHandle()` 所有出口应用 |
| 修改 | `src/jobs/backfill-account.ts` | `updateCursor` 调用补入 `latestTweetCreatedAt`（首页）和 `oldestTweetCreatedAt`（每页） |
| 修改 | `src/jobs/sync-account.ts` | `updateCursor` 调用补入 `latestTweetCreatedAt`（首页第一条） |
| 修改 | `src/jobs/status.ts` | 输出补充 created_at 时间范围、成本、最近错误 |

---

## Section 1: Handle 规范化

### 设计

在 `src/utils/cli.ts` 新增纯函数：

```typescript
export function normalizeHandle(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle;
}
```

在 `resolveHandle()` 内所有出口统一调用：

```typescript
export function resolveHandle(): string {
  const fromArg = getArg('handle');
  if (fromArg) return normalizeHandle(fromArg);

  const accounts = loadAccountsConfig();
  const enabled = accounts.find(a => a.enabled);
  if (enabled) return normalizeHandle(enabled.handle);

  logger.error('No handle provided and no enabled account in config');
  process.exit(1);
}
```

### 完成标准

- `--handle @aleabitoreddit` 和 `--handle aleabitoreddit` 行为完全一致
- 内部流转、数据库主键、导出目录均不含前导 `@`
- 展示层（status 输出 `@${handle}`）保留 `@` 前缀

---

## Section 2: Cursor 时间边界字段写入

### 设计

**backfill-account.ts** 写入时机：

- **首页**：`latestTweetCreatedAt = sortedTweets[0].created_at`（最新推文，只写一次）
- **每页**：`oldestTweetCreatedAt = sortedTweets[sortedTweets.length - 1].created_at`（随分页推进）

```typescript
// 首页额外写入 latestTweetCreatedAt
if (isFirstPage) {
  updateCursor(handle, {
    latestTweetId: newestId,
    latestTweetCreatedAt: sortedTweets[0].created_at,
  });
}

// 每页更新 oldest（含 latestTweetId 已在首页写入，此处只更新 oldest）
updateCursor(handle, {
  oldestTweetId: oldestId,
  oldestTweetCreatedAt: sortedTweets[sortedTweets.length - 1].created_at,
  lastPaginationToken: nextToken ?? null,
});
```

**sync-account.ts** 写入时机：

- sync 完成后的原子 cursor 更新，补入 `latestTweetCreatedAt = firstPageTweets[0].created_at`

```typescript
updateCursor(handle, {
  latestTweetId: newestId,
  latestTweetCreatedAt: firstPageTweets[0].created_at,
});
```

### 完成标准

- backfill 完成后，`fetch_cursors` 中 `latestTweetCreatedAt` 和 `oldestTweetCreatedAt` 均不为 null
- 值来自 X API 原始 `tweet.created_at`（ISO 8601 格式）
- sync 每次成功后更新 `latestTweetCreatedAt`

---

## Section 3: Status 输出增强

### 设计

修改 `src/jobs/status.ts`，在现有结构基础上追加时间、成本、错误信息：

```
Account:   @handle
User ID:   123456789
Posts:     1842 total
Backfill:  completed ✓
Latest:    1799xxx  (2026-06-09T14:32Z)
Oldest:    1700xxx  (2025-01-01T08:00Z)

Last run:  sync · success · 3 inserted · 2026-06-09T14:35Z · $0.01
Last err:  n/a
```

实现细节：
- 时间格式：`value?.slice(0, 16) + 'Z'`，null 时省略括号部分
- 成本：`'$' + estimatedCostUsd.toFixed(2)`，null 时省略 `·` 及成本
- 错误行：仅在 `latestRun` 存在时输出 `Last err:  ${latestRun.errorMessage ?? 'n/a'}`

### 完成标准

- 可一眼判断数据覆盖时间范围
- 可一眼判断上次 run 的成本
- 可一眼判断是否有最近错误
