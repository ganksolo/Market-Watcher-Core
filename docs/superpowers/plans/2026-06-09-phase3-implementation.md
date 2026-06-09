# Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 services 薄 DB 层（account / cursor / run-log）和 resolve-account job，完成 `pnpm x:resolve --handle <handle>` 命令。

**Architecture:** 三个 service 文件各自封装一张或两张 Drizzle 表的 CRUD，不含业务逻辑；resolve-account job 调用这些 services 和 XApiClient，完整记录 fetch_run。

**Tech Stack:** drizzle-orm@0.31.4（better-sqlite3）、Node.js 22 原生 fetch、TypeScript、tsx

---

## 文件清单

| 操作 | 路径 | 职责 |
|---|---|---|
| 创建 | `src/services/account-service.ts` | watch_accounts + x_users 的 upsert/get |
| 创建 | `src/services/cursor-service.ts` | fetch_cursors 的 init/get |
| 创建 | `src/services/run-log-service.ts` | fetch_runs 的 create/finish/get |
| 创建 | `src/jobs/resolve-account.ts` | CLI 入口，调用 API + services |

---

## Task 1: `src/services/account-service.ts`

**Files:**
- 创建: `src/services/account-service.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { watchAccounts, xUsers } from '../db/schema';

export function upsertWatchAccount(
  handle: string,
  xUserId: string,
  now: string,
): void {
  db.insert(watchAccounts)
    .values({
      handle,
      xUserId,
      firstSeenAt: now,
      lastCheckedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: watchAccounts.handle,
      set: { xUserId, lastCheckedAt: now, updatedAt: now },
    })
    .run();
}

export function getWatchAccount(handle: string) {
  return db
    .select()
    .from(watchAccounts)
    .where(eq(watchAccounts.handle, handle))
    .get();
}

export function upsertXUser(params: {
  xUserId: string;
  username: string;
  name: string | null;
  description: string | null;
  location: string | null;
  verified: number | null;
  verifiedType: string | null;
  followersCount: number | null;
  followingCount: number | null;
  tweetCount: number | null;
  listedCount: number | null;
  rawJson: string;
  fetchedAt: string;
}): void {
  db.insert(xUsers)
    .values(params)
    .onConflictDoUpdate({
      target: xUsers.xUserId,
      set: {
        username: params.username,
        name: params.name,
        description: params.description,
        location: params.location,
        verified: params.verified,
        verifiedType: params.verifiedType,
        followersCount: params.followersCount,
        followingCount: params.followingCount,
        tweetCount: params.tweetCount,
        listedCount: params.listedCount,
        rawJson: params.rawJson,
        fetchedAt: params.fetchedAt,
      },
    })
    .run();
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: Smoke test — upsert + get + 幂等性**

```bash
npx tsx -e "
import { upsertWatchAccount, getWatchAccount } from './src/services/account-service.js';
const now = new Date().toISOString();
upsertWatchAccount('_smoke_test_handle', 'uid_001', now);
const a1 = getWatchAccount('_smoke_test_handle');
console.assert(a1?.xUserId === 'uid_001', 'first insert: xUserId');
console.assert(a1?.createdAt === now, 'first insert: createdAt');

// 幂等：第二次 upsert 只更新 xUserId + lastCheckedAt，createdAt 不变
const later = new Date(Date.now() + 1000).toISOString();
upsertWatchAccount('_smoke_test_handle', 'uid_002', later);
const a2 = getWatchAccount('_smoke_test_handle');
console.assert(a2?.xUserId === 'uid_002', 'update: xUserId changed');
console.assert(a2?.createdAt === now, 'update: createdAt unchanged');
console.assert(a2?.lastCheckedAt === later, 'update: lastCheckedAt updated');
console.log('account-service ok');
"
```

期望输出：`account-service ok`

- [ ] **Step 4: Commit**

```bash
git add src/services/account-service.ts
git commit -m "feat: add account-service (watch_accounts + x_users upsert/get)"
```

---

## Task 2: `src/services/cursor-service.ts`

**Files:**
- 创建: `src/services/cursor-service.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { fetchCursors } from '../db/schema';

export function initCursor(handle: string, updatedAt: string): void {
  db.insert(fetchCursors)
    .values({ accountHandle: handle, updatedAt })
    .onConflictDoNothing()
    .run();
}

export function getCursor(handle: string) {
  return db
    .select()
    .from(fetchCursors)
    .where(eq(fetchCursors.accountHandle, handle))
    .get();
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: Smoke test — init + 幂等性（已存在不覆盖）**

```bash
npx tsx -e "
import { initCursor, getCursor } from './src/services/cursor-service.js';
const now = new Date().toISOString();

// 首次 init
initCursor('_smoke_test_handle', now);
const c1 = getCursor('_smoke_test_handle');
console.assert(c1?.accountHandle === '_smoke_test_handle', 'cursor created');
console.assert(c1?.backfillCompleted === 0, 'backfillCompleted default 0');

// 第二次 init 应完全跳过（不覆盖）
const later = new Date(Date.now() + 1000).toISOString();
initCursor('_smoke_test_handle', later);
const c2 = getCursor('_smoke_test_handle');
console.assert(c2?.updatedAt === now, 'second init: updatedAt unchanged');
console.log('cursor-service ok');
"
```

期望输出：`cursor-service ok`

- [ ] **Step 4: Commit**

```bash
git add src/services/cursor-service.ts
git commit -m "feat: add cursor-service (fetch_cursors init/get)"
```

---

## Task 3: `src/services/run-log-service.ts`

**Files:**
- 创建: `src/services/run-log-service.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { desc, eq } from 'drizzle-orm';
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
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: Smoke test — createRun + finishRun + getLatestRun**

```bash
npx tsx -e "
import { createRun, finishRun, getLatestRun } from './src/services/run-log-service.js';
const now = new Date().toISOString();

const id = createRun('resolve_user', '_smoke_test_handle', now);
console.assert(typeof id === 'number' && id > 0, 'createRun returns positive number id');

const run = getLatestRun('_smoke_test_handle');
console.assert(run?.status === 'running', 'initial status is running');
console.assert(run?.finishedAt === null, 'finishedAt initially null');

finishRun(id, { status: 'success', finishedAt: new Date().toISOString(), estimatedUserReads: 1, estimatedCostUsd: 0.01 });
const run2 = getLatestRun('_smoke_test_handle');
console.assert(run2?.status === 'success', 'status updated to success');
console.assert(run2?.estimatedUserReads === 1, 'estimatedUserReads updated');
console.log('run-log-service ok');
"
```

期望输出：`run-log-service ok`

- [ ] **Step 4: Commit**

```bash
git add src/services/run-log-service.ts
git commit -m "feat: add run-log-service (fetch_runs create/finish/get)"
```

---

## Task 4: `src/jobs/resolve-account.ts`

**Files:**
- 创建: `src/jobs/resolve-account.ts`

- [ ] **Step 1: 创建文件**

```typescript
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { requireArg } from '../utils/cli';
import { logger } from '../utils/logger';
import { nowISO } from '../utils/date';
import { createXApiClient, ApiError } from '../clients/x-api-client';
import type { XApiResponse, XUser } from '../clients/x-api-types';
import { upsertWatchAccount, upsertXUser } from '../services/account-service';
import { initCursor } from '../services/cursor-service';
import { createRun, finishRun } from '../services/run-log-service';

dotenv.config();

const USER_FIELDS = [
  'id', 'name', 'username', 'description', 'location',
  'verified', 'verified_type', 'public_metrics', 'created_at',
].join(',');

async function main(): Promise<void> {
  const handle = requireArg('handle');

  const policyPath = path.resolve('config/fetch-policy.json');
  const policy: { default: { estimatedUserReadCost: number } } =
    JSON.parse(fs.readFileSync(policyPath, 'utf-8'));

  const runId = createRun('resolve_user', handle, nowISO());

  try {
    const client = createXApiClient();

    logger.info({ handle }, 'Resolving account');

    const response = await client.get<XApiResponse<XUser>>(
      `/users/by/username/${handle}`,
      { 'user.fields': USER_FIELDS },
    );

    if (response.errors?.length) {
      throw new Error(`API errors: ${response.errors.map(e => e.title).join(', ')}`);
    }
    if (!response.data) {
      throw new Error(`No user data returned for handle: ${handle}`);
    }

    const user = response.data;
    const now = nowISO();

    upsertWatchAccount(handle, user.id, now);
    upsertXUser({
      xUserId: user.id,
      username: user.username,
      name: user.name ?? null,
      description: user.description ?? null,
      location: user.location ?? null,
      verified: user.verified ? 1 : null,
      verifiedType: user.verified_type ?? null,
      followersCount: user.public_metrics?.followers_count ?? null,
      followingCount: user.public_metrics?.following_count ?? null,
      tweetCount: user.public_metrics?.tweet_count ?? null,
      listedCount: user.public_metrics?.listed_count ?? null,
      rawJson: JSON.stringify(response),
      fetchedAt: now,
    });
    initCursor(handle, now);

    finishRun(runId, {
      status: 'success',
      finishedAt: now,
      estimatedUserReads: 1,
      estimatedCostUsd: policy.default.estimatedUserReadCost,
    });

    logger.info({ handle, xUserId: user.id }, 'Resolved account successfully');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (err instanceof ApiError) {
      if (err.status === 401) logger.error('X_BEARER_TOKEN is invalid or expired');
      else if (err.status === 404) logger.error({ handle }, 'Account not found or not accessible');
    }

    finishRun(runId, {
      status: 'failed',
      finishedAt: nowISO(),
      errorMessage,
    });

    logger.error({ err }, 'resolve-account failed');
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: 运行 resolve（需要真实 handle 和有效 X_BEARER_TOKEN）**

先确认 `.env` 中 `X_BEARER_TOKEN` 已填写，以及 `config/accounts.json` 中 handle 已改为真实账号。

```bash
pnpm x:resolve --handle <真实的X账号handle，不含@>
```

期望输出示例：
```
{"level":30,"handle":"<handle>","msg":"Resolving account"}
{"level":30,"handle":"<handle>","xUserId":"<uid>","msg":"Resolved account successfully"}
```

验证数据已写入：
```bash
npx tsx -e "
import { getWatchAccount } from './src/services/account-service.js';
import { getCursor } from './src/services/cursor-service.js';
import { getLatestRun } from './src/services/run-log-service.js';
const handle = process.argv[1];
console.log('watch_account:', getWatchAccount(handle));
console.log('cursor:', getCursor(handle));
console.log('latest_run:', getLatestRun(handle));
" <真实handle>
```

期望：三条记录均不为 undefined，run status = 'success'

- [ ] **Step 4: Commit**

```bash
git add src/jobs/resolve-account.ts
git commit -m "feat: add resolve-account job (handle -> user_id, saves DB records)"
```

---

## 完成标准

- `npx tsc --noEmit` 零错误
- 三个 service smoke tests 全部输出 `ok`
- `pnpm x:resolve --handle <handle>` 成功后：
  - `watch_accounts` 有该 handle 记录，`x_user_id` 已填写
  - `x_users` 有用户资料和 `raw_json`
  - `fetch_cursors` 有该 handle 记录
  - `fetch_runs` 最新一条 `status = 'success'`
