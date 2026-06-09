# Phase 7a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复三个 P0 低风险问题：handle 输入规范化、cursor 时间边界字段写入、status 输出增强。

**Architecture:** 修改 5 个文件，零 schema 变更。`cursor-service.ts` 的 `updateCursor` patch 已有目标字段（可选），直接扩展现有调用点即可。项目无测试套件，验证方式为 `npx tsc --noEmit` + CLI 手动运行。

**Tech Stack:** Node.js 22、TypeScript、tsx、drizzle-orm（better-sqlite3）

---

## 文件清单

| 操作 | 文件 |
|---|---|
| 修改 | `src/utils/cli.ts` |
| 修改 | `src/services/run-log-service.ts` |
| 修改 | `src/jobs/backfill-account.ts` |
| 修改 | `src/jobs/sync-account.ts` |
| 修改 | `src/jobs/status.ts` |

---

## Task 1: Handle 规范化 (`src/utils/cli.ts`)

**Files:**
- 修改: `src/utils/cli.ts`

- [ ] **Step 1: 修改文件**

将 `src/utils/cli.ts` 完整替换为：

```typescript
import fs from 'fs';
import path from 'path';

export function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

export function requireArg(name: string): string {
  const val = getArg(name);
  if (!val) {
    console.error(`Missing required argument: --${name}`);
    process.exit(1);
  }
  return val;
}

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

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: 验证 `@` 前缀被去除**

```bash
npx tsx -e "
const { normalizeHandle, resolveHandle } = require('./src/utils/cli');
console.log(normalizeHandle('@aleabitoreddit'));   // 期望: aleabitoreddit
console.log(normalizeHandle('aleabitoreddit'));     // 期望: aleabitoreddit
console.log(normalizeHandle('@'));                  // 期望: ''
"
```

期望输出：
```
aleabitoreddit
aleabitoreddit

```

- [ ] **Step 4: Commit**

```bash
git add src/utils/cli.ts
git commit -m "feat: add normalizeHandle() to cli utils, strip leading @ in resolveHandle()"
```

---

## Task 2: `getLatestFailedRun` (`src/services/run-log-service.ts`)

**Files:**
- 修改: `src/services/run-log-service.ts`

- [ ] **Step 1: 修改文件**

将 `src/services/run-log-service.ts` 完整替换为：

```typescript
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { fetchRuns } from '../db/schema';

export function createRun(
  runType: string,
  handle: string,
  startedAt: string,
): number {
  const result = db
    .insert(fetchRuns)
    .values({ runType, accountHandle: handle, startedAt, status: 'running' })
    .run();
  return Number(result.lastInsertRowid);
}

export function finishRun(
  id: number,
  patch: {
    finishedAt?: string;
    status?: string;
    requestedPages?: number;
    fetchedPosts?: number;
    insertedPosts?: number;
    duplicatedPosts?: number;
    estimatedPostReads?: number;
    estimatedUserReads?: number;
    estimatedCostUsd?: number;
    errorMessage?: string;
    rawLogPath?: string;
  },
): void {
  db.update(fetchRuns).set(patch).where(eq(fetchRuns.id, id)).run();
}

export function getLatestRun(handle: string) {
  return db
    .select()
    .from(fetchRuns)
    .where(eq(fetchRuns.accountHandle, handle))
    .orderBy(desc(fetchRuns.id))
    .limit(1)
    .get();
}

export function getLatestFailedRun(handle: string) {
  return db
    .select()
    .from(fetchRuns)
    .where(and(eq(fetchRuns.accountHandle, handle), eq(fetchRuns.status, 'failed')))
    .orderBy(desc(fetchRuns.id))
    .limit(1)
    .get();
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: 验证函数可调用**

```bash
npx tsx -e "
const { getLatestFailedRun, getLatestRun } = require('./src/services/run-log-service');
const failed = getLatestFailedRun('aleabitoreddit');
const latest = getLatestRun('aleabitoreddit');
console.log('latest failed run:', failed?.status ?? 'none');
console.log('latest run:', latest?.status ?? 'none');
"
```

期望：无报错，打印 run 状态（可以是 none 或 success/failed）

- [ ] **Step 4: Commit**

```bash
git add src/services/run-log-service.ts
git commit -m "feat: add getLatestFailedRun() to run-log-service"
```

---

## Task 3: Cursor 时间字段写入 — backfill (`src/jobs/backfill-account.ts`)

**Files:**
- 修改: `src/jobs/backfill-account.ts:157-167`

现有代码段（第 157–167 行）：

```typescript
const cursorPatch: Parameters<typeof updateCursor>[1] = {
  lastPaginationToken: meta?.next_token ?? null,
  oldestTweetId: meta?.oldest_id ?? undefined,
  ...(isLastPage ? { backfillCompleted: 1 } : {}),
  updatedAt: pageNow,
};
if (isFirstPage && meta?.newest_id) {
  cursorPatch.latestTweetId = meta.newest_id;
}
updateCursor(handle, cursorPatch);
isFirstPage = false;
```

- [ ] **Step 1: 替换 cursor 构建逻辑**

将上面代码段替换为：

```typescript
const cursorPatch: Parameters<typeof updateCursor>[1] = {
  lastPaginationToken: meta?.next_token ?? null,
  oldestTweetId: meta?.oldest_id ?? undefined,
  ...(isLastPage ? { backfillCompleted: 1 } : {}),
  updatedAt: pageNow,
};
if (isFirstPage && meta?.newest_id) {
  cursorPatch.latestTweetId = meta.newest_id;
  const newestCreatedAt = tweets[0]?.created_at;
  if (newestCreatedAt) cursorPatch.latestTweetCreatedAt = newestCreatedAt;
}
const oldestCreatedAt = tweets[tweets.length - 1]?.created_at;
if (tweets.length > 0 && oldestCreatedAt) {
  cursorPatch.oldestTweetCreatedAt = oldestCreatedAt;
}
updateCursor(handle, cursorPatch);
isFirstPage = false;
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: 验证字段写入**

先查数据库中有记录的 handle（如 `aleabitoreddit`），检查 cursor 当前时间字段：

```bash
npx tsx -e "
const { getCursor } = require('./src/services/cursor-service');
const c = getCursor('aleabitoreddit');
console.log('latestTweetCreatedAt:', c?.latestTweetCreatedAt ?? 'null');
console.log('oldestTweetCreatedAt:', c?.oldestTweetCreatedAt ?? 'null');
"
```

此时应仍为 null（还未重新 backfill）。Task 3 的目的是保证代码路径正确，真实数据在下次 backfill 时才会写入。

- [ ] **Step 4: Commit**

```bash
git add src/jobs/backfill-account.ts
git commit -m "feat: write latestTweetCreatedAt and oldestTweetCreatedAt in backfill cursor update"
```

---

## Task 4: Cursor 时间字段写入 — sync (`src/jobs/sync-account.ts`)

**Files:**
- 修改: `src/jobs/sync-account.ts`

需要两处修改：
1. 在 while 循环前声明 `firstPageTweets` 变量（现有 `let newestId` 附近）
2. 在循环体内捕获首页 tweets
3. 在 cursor 更新处写入 `latestTweetCreatedAt`

- [ ] **Step 1: 添加 `firstPageTweets` 声明**

在第 77–78 行（`let newestId` 声明处）：

现有代码：
```typescript
let pagesCount = 0;
let insertedPosts = 0;
let duplicatedPosts = 0;
let newestId: string | undefined = undefined;
let currentPaginationToken: string | undefined;
```

替换为：
```typescript
let pagesCount = 0;
let insertedPosts = 0;
let duplicatedPosts = 0;
let newestId: string | undefined = undefined;
let currentPaginationToken: string | undefined;
let firstPageTweets: XTweet[] = [];
```

- [ ] **Step 2: 捕获首页 tweets**

在第 143–145 行（`if (pagesCount === 0 && meta?.newest_id)` 块）之后，添加一行：

现有代码：
```typescript
if (pagesCount === 0 && meta?.newest_id) {
  newestId = meta.newest_id;
}
```

替换为：
```typescript
if (pagesCount === 0 && meta?.newest_id) {
  newestId = meta.newest_id;
}
if (pagesCount === 0) {
  firstPageTweets = tweets;
}
```

- [ ] **Step 3: 更新 cursor 写入**

在第 189–191 行（`if (newestId)` 块）：

现有代码：
```typescript
if (newestId) {
  updateCursor(handle, { latestTweetId: newestId, updatedAt: nowISO() });
}
```

替换为：
```typescript
if (newestId) {
  const latestCreatedAt = firstPageTweets[0]?.created_at;
  updateCursor(handle, {
    latestTweetId: newestId,
    ...(latestCreatedAt ? { latestTweetCreatedAt: latestCreatedAt } : {}),
    updatedAt: nowISO(),
  });
}
```

- [ ] **Step 4: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 5: Commit**

```bash
git add src/jobs/sync-account.ts
git commit -m "feat: write latestTweetCreatedAt in sync cursor update"
```

---

## Task 5: Status 输出增强 (`src/jobs/status.ts`)

**Files:**
- 修改: `src/jobs/status.ts`

- [ ] **Step 1: 修改文件**

将 `src/jobs/status.ts` 完整替换为：

```typescript
import dotenv from 'dotenv';
import { eq, count } from 'drizzle-orm';
import { resolveHandle } from '../utils/cli';
import { getWatchAccount } from '../services/account-service';
import { getCursor } from '../services/cursor-service';
import { getLatestRun, getLatestFailedRun } from '../services/run-log-service';
import { db } from '../db';
import { xPosts } from '../db/schema';

dotenv.config();

function main(): void {
  const handle = resolveHandle();

  const account = getWatchAccount(handle);
  const cursor = getCursor(handle);
  const latestRun = getLatestRun(handle);
  const failedRun = getLatestFailedRun(handle);

  const countResult = db
    .select({ value: count() })
    .from(xPosts)
    .where(eq(xPosts.authorHandle, handle))
    .get();
  const postCount = countResult?.value ?? 0;

  const backfillStatus =
    cursor?.backfillCompleted === 1
      ? 'completed ✓'
      : cursor?.latestTweetId
        ? 'in progress'
        : 'not started';

  const latestTime = cursor?.latestTweetCreatedAt ? ` (${cursor.latestTweetCreatedAt})` : '';
  const oldestTime = cursor?.oldestTweetCreatedAt ? ` (${cursor.oldestTweetCreatedAt})` : '';

  const lines = [
    `Account:   @${handle}`,
    `User ID:   ${account?.xUserId ?? 'not resolved'}`,
    `Posts:     ${postCount} total`,
    `Backfill:  ${cursor ? backfillStatus : 'not started'}`,
    `Latest:    ${cursor?.latestTweetId ?? 'n/a'}${latestTime}`,
    `Oldest:    ${cursor?.oldestTweetId ?? 'n/a'}${oldestTime}`,
    '',
  ];

  if (latestRun) {
    const cost =
      latestRun.estimatedCostUsd != null
        ? ` · $${latestRun.estimatedCostUsd.toFixed(2)}`
        : '';
    lines.push(
      `Last run:  ${latestRun.runType} · ${latestRun.status} · ${latestRun.insertedPosts ?? 0} inserted · ${latestRun.startedAt}${cost}`,
    );
  } else {
    lines.push('Last run:  no runs yet');
  }

  lines.push(`Last err:  ${failedRun?.errorMessage ?? 'n/a'}`);

  console.log(lines.join('\n'));
}

main();
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: 运行 status**

```bash
pnpm x:status --handle aleabitoreddit
```

期望输出格式（字段值因实际数据而异）：
```
Account:   @aleabitoreddit
User ID:   <id>
Posts:     <N> total
Backfill:  completed ✓
Latest:    <tweet_id>
Oldest:    <tweet_id>

Last run:  sync · success · <N> inserted · <timestamp> · $0.01
Last err:  n/a
```

注意：`Latest` / `Oldest` 行的时间括号部分此时仍为空（cursor 时间字段在 Task 3/4 之后只有重新运行 backfill/sync 才会填入），这是预期行为。

- [ ] **Step 4: 验证 `@` 前缀输入**

```bash
pnpm x:status --handle @aleabitoreddit
```

期望：与上面完全一致的输出（handle normalize 已生效）

- [ ] **Step 5: 验证未知账号优雅降级**

```bash
pnpm x:status --handle nonexistent_xyz_handle
```

期望：所有字段显示 `not resolved` / `0 total` / `not started` / `n/a`，不报错不 exit 1

- [ ] **Step 6: Commit**

```bash
git add src/jobs/status.ts
git commit -m "feat: enhance status output with time ranges, cost, and last failed run error"
```

---

## 完成标准

- `npx tsc --noEmit` 全程零错误
- `pnpm x:status --handle @handle` 与 `--handle handle` 输出完全一致
- status 输出包含 Latest/Oldest 时间范围（字段非空时）、Last run 成本、Last err 信息
- backfill / sync 代码路径已就绪，下次运行后将自动填写时间字段
