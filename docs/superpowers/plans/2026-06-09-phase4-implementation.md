# Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `post-service`（x_posts 写入/查询）、为 `cursor-service` 补充 `updateCursor`，以及 `backfill-account` job，使 `pnpm x:backfill` 能分页拉取 X timeline、写入 SQLite、支持断点续传与成本保护。

**Architecture:** 三个改动相互独立：post-service 是纯 DB 薄层；cursor-service 追加一个 update 函数；backfill-account job 调用这三个 service + XApiClient，实现完整的分页循环。Services 不含业务逻辑，业务逻辑全在 job 层。

**Tech Stack:** drizzle-orm@0.31.4（better-sqlite3）、Node.js 22 原生 fetch、TypeScript、tsx

---

## 文件清单

| 操作 | 路径 | 职责 |
|---|---|---|
| 创建 | `src/services/post-service.ts` | `upsertPost()` + `getPostsByHandle()` |
| 修改 | `src/services/cursor-service.ts` | 新增 `updateCursor()` |
| 创建 | `src/jobs/backfill-account.ts` | CLI 入口：分页拉取、存储、cursor 管理、成本保护 |

---

## Task 1: `src/services/post-service.ts`

**Files:**
- 创建: `src/services/post-service.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { xPosts } from '../db/schema';

export function upsertPost(params: {
  tweetId: string;
  authorId: string;
  authorHandle: string;
  text: string;
  lang: string | null;
  createdAt: string;
  conversationId: string | null;
  inReplyToUserId: string | null;
  referencedType: string | null;
  referencedTweetId: string | null;
  likeCount: number | null;
  replyCount: number | null;
  repostCount: number | null;
  quoteCount: number | null;
  bookmarkCount: number | null;
  impressionCount: number | null;
  url: string;
  rawJson: string;
  firstFetchedAt: string;
  lastFetchedAt: string;
}): { inserted: boolean } {
  const result = db
    .insert(xPosts)
    .values(params)
    .onConflictDoNothing()
    .run();
  return { inserted: result.changes > 0 };
}

export function getPostsByHandle(
  handle: string,
  opts?: { limit?: number; offset?: number },
) {
  return db
    .select()
    .from(xPosts)
    .where(eq(xPosts.authorHandle, handle))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0)
    .all();
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: Smoke test — upsert + 去重 + getPostsByHandle**

```bash
npx tsx -e "
const { upsertPost, getPostsByHandle } = require('./src/services/post-service');
const now = new Date().toISOString();

const r1 = upsertPost({
  tweetId: '_smoke_tweet_001',
  authorId: 'uid_001',
  authorHandle: '_smoke_handle',
  text: 'smoke test tweet',
  lang: 'en',
  createdAt: now,
  conversationId: null,
  inReplyToUserId: null,
  referencedType: null,
  referencedTweetId: null,
  likeCount: 5,
  replyCount: 1,
  repostCount: 2,
  quoteCount: 0,
  bookmarkCount: 3,
  impressionCount: 100,
  url: 'https://x.com/_smoke_handle/status/_smoke_tweet_001',
  rawJson: JSON.stringify({ id: '_smoke_tweet_001' }),
  firstFetchedAt: now,
  lastFetchedAt: now,
});
console.assert(r1.inserted === true, 'first insert: inserted = true');

const r2 = upsertPost({
  tweetId: '_smoke_tweet_001',
  authorId: 'uid_001',
  authorHandle: '_smoke_handle',
  text: 'updated text should be ignored',
  lang: 'en',
  createdAt: now,
  conversationId: null,
  inReplyToUserId: null,
  referencedType: null,
  referencedTweetId: null,
  likeCount: 99,
  replyCount: 1,
  repostCount: 2,
  quoteCount: 0,
  bookmarkCount: 3,
  impressionCount: 100,
  url: 'https://x.com/_smoke_handle/status/_smoke_tweet_001',
  rawJson: JSON.stringify({ id: '_smoke_tweet_001' }),
  firstFetchedAt: now,
  lastFetchedAt: now,
});
console.assert(r2.inserted === false, 'duplicate: inserted = false');

const posts = getPostsByHandle('_smoke_handle');
console.assert(posts.length === 1, 'only 1 post stored');
console.assert(posts[0].likeCount === 5, 'likeCount unchanged after duplicate insert');
console.log('post-service ok');
"
```

期望输出：`post-service ok`

- [ ] **Step 4: Commit**

```bash
git add src/services/post-service.ts
git commit -m "feat: add post-service (x_posts upsert/query, ON CONFLICT DO NOTHING)"
```

---

## Task 2: `src/services/cursor-service.ts` — 新增 `updateCursor`

**Files:**
- 修改: `src/services/cursor-service.ts`

- [ ] **Step 1: 在文件末尾追加 `updateCursor`**

将 `src/services/cursor-service.ts` 修改为：

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

export function updateCursor(
  handle: string,
  patch: {
    latestTweetId?: string;
    latestTweetCreatedAt?: string;
    oldestTweetId?: string;
    oldestTweetCreatedAt?: string;
    lastPaginationToken?: string | null;
    backfillCompleted?: number;
    updatedAt: string;
  },
): void {
  db.update(fetchCursors).set(patch).where(eq(fetchCursors.accountHandle, handle)).run();
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: Smoke test — updateCursor 更新各字段，包括 null 清除**

```bash
npx tsx -e "
const { initCursor, getCursor, updateCursor } = require('./src/services/cursor-service');
const now = new Date().toISOString();

initCursor('_smoke_cursor_handle', now);

updateCursor('_smoke_cursor_handle', {
  latestTweetId: 'tweet_latest_001',
  oldestTweetId: 'tweet_oldest_001',
  lastPaginationToken: 'tok_abc123',
  updatedAt: now,
});
const c = getCursor('_smoke_cursor_handle');
console.assert(c?.latestTweetId === 'tweet_latest_001', 'latestTweetId updated');
console.assert(c?.oldestTweetId === 'tweet_oldest_001', 'oldestTweetId updated');
console.assert(c?.lastPaginationToken === 'tok_abc123', 'lastPaginationToken updated');
console.assert(c?.backfillCompleted === 0, 'backfillCompleted still 0');

const later = new Date(Date.now() + 1000).toISOString();
updateCursor('_smoke_cursor_handle', {
  backfillCompleted: 1,
  lastPaginationToken: null,
  updatedAt: later,
});
const c2 = getCursor('_smoke_cursor_handle');
console.assert(c2?.backfillCompleted === 1, 'backfillCompleted set to 1');
console.assert(c2?.lastPaginationToken === null, 'lastPaginationToken cleared to null');
console.assert(c2?.latestTweetId === 'tweet_latest_001', 'latestTweetId preserved');
console.log('updateCursor ok');
"
```

期望输出：`updateCursor ok`

- [ ] **Step 4: Commit**

```bash
git add src/services/cursor-service.ts
git commit -m "feat: add updateCursor to cursor-service (patch fetch_cursors by handle)"
```

---

## Task 3: `src/jobs/backfill-account.ts`

**Files:**
- 创建: `src/jobs/backfill-account.ts`

- [ ] **Step 1: 创建文件**

```typescript
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { resolveHandle, getArg } from '../utils/cli';
import { logger } from '../utils/logger';
import { nowISO } from '../utils/date';
import { sleep } from '../utils/sleep';
import { createXApiClient, ApiError } from '../clients/x-api-client';
import type { XApiListResponse, XTweet } from '../clients/x-api-types';
import { getWatchAccount } from '../services/account-service';
import { getCursor, updateCursor } from '../services/cursor-service';
import { upsertPost } from '../services/post-service';
import { createRun, finishRun } from '../services/run-log-service';

dotenv.config();

const TWEET_FIELDS = [
  'id', 'text', 'created_at', 'author_id', 'conversation_id',
  'in_reply_to_user_id', 'lang', 'public_metrics', 'referenced_tweets',
].join(',');

async function main(): Promise<void> {
  const handle = resolveHandle();
  const maxPagesArg = getArg('max-pages');

  const policyPath = path.resolve('config/fetch-policy.json');
  const policy: {
    default: {
      maxResultsPerPage: number;
      maxPagesPerRun: number;
      includeReplies: boolean;
      includeRetweets: boolean;
      includeQuotes: boolean;
      sleepMsBetweenRequests: number;
      estimatedPostReadCost: number;
      maxEstimatedCostPerRun: number;
    };
  } = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));

  const p = policy.default;
  const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;

  const cursor = getCursor(handle);
  if (cursor?.backfillCompleted === 1) {
    logger.info({ handle }, 'Backfill already completed, nothing to do');
    return;
  }

  const account = getWatchAccount(handle);
  if (!account?.xUserId) {
    logger.error({ handle }, 'No x_user_id found — run pnpm x:resolve first');
    process.exit(1);
  }
  const xUserId = account.xUserId;

  let runId: number | undefined = undefined;

  try {
    runId = createRun('backfill', handle, nowISO());

    const client = createXApiClient();

    const excludeParts: string[] = [];
    if (!p.includeRetweets) excludeParts.push('retweets');
    if (!p.includeReplies) excludeParts.push('replies');

    let pagesCount = 0;
    let insertedPosts = 0;
    let duplicatedPosts = 0;
    let currentPaginationToken: string | undefined = cursor?.lastPaginationToken ?? undefined;
    let isFirstPage = !currentPaginationToken;

    logger.info({ handle, xUserId, maxPages }, 'Starting backfill');

    while (true) {
      const estimatedCostSoFar = pagesCount * p.maxResultsPerPage * p.estimatedPostReadCost;
      if (estimatedCostSoFar >= p.maxEstimatedCostPerRun) {
        logger.warn({ handle, pagesCount, estimatedCostSoFar }, 'Cost limit reached');
        finishRun(runId, {
          status: 'stopped_by_cost_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: insertedPosts + duplicatedPosts,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: pagesCount * p.maxResultsPerPage,
          estimatedCostUsd: estimatedCostSoFar,
        });
        return;
      }

      if (pagesCount >= maxPages) {
        logger.info({ handle, pagesCount }, 'Page limit reached');
        finishRun(runId, {
          status: 'stopped_by_page_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: insertedPosts + duplicatedPosts,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: pagesCount * p.maxResultsPerPage,
          estimatedCostUsd: pagesCount * p.maxResultsPerPage * p.estimatedPostReadCost,
        });
        return;
      }

      const params: Record<string, string> = {
        'tweet.fields': TWEET_FIELDS,
        max_results: String(p.maxResultsPerPage),
      };
      if (excludeParts.length) params.exclude = excludeParts.join(',');
      if (currentPaginationToken) params.pagination_token = currentPaginationToken;

      logger.info({ handle, page: pagesCount + 1, currentPaginationToken }, 'Fetching page');

      const response = await client.get<XApiListResponse<XTweet>>(
        `/2/users/${xUserId}/tweets`,
        params,
      );

      const tweets = response.data ?? [];
      const meta = response.meta;

      const pageNow = nowISO();
      for (const tweet of tweets) {
        if (!p.includeQuotes && tweet.referenced_tweets?.[0]?.type === 'quoted') continue;

        const result = upsertPost({
          tweetId: tweet.id,
          authorId: tweet.author_id ?? xUserId,
          authorHandle: handle,
          text: tweet.text,
          lang: tweet.lang ?? null,
          createdAt: tweet.created_at ?? pageNow,
          conversationId: tweet.conversation_id ?? null,
          inReplyToUserId: tweet.in_reply_to_user_id ?? null,
          referencedType: tweet.referenced_tweets?.[0]?.type ?? null,
          referencedTweetId: tweet.referenced_tweets?.[0]?.id ?? null,
          likeCount: tweet.public_metrics?.like_count ?? null,
          replyCount: tweet.public_metrics?.reply_count ?? null,
          repostCount: tweet.public_metrics?.retweet_count ?? null,
          quoteCount: tweet.public_metrics?.quote_count ?? null,
          bookmarkCount: tweet.public_metrics?.bookmark_count ?? null,
          impressionCount: tweet.public_metrics?.impression_count ?? null,
          url: `https://x.com/${handle}/status/${tweet.id}`,
          rawJson: JSON.stringify(tweet),
          firstFetchedAt: pageNow,
          lastFetchedAt: pageNow,
        });
        result.inserted ? insertedPosts++ : duplicatedPosts++;
      }

      const cursorPatch: Parameters<typeof updateCursor>[1] = {
        lastPaginationToken: meta?.next_token ?? null,
        oldestTweetId: meta?.oldest_id ?? undefined,
        updatedAt: pageNow,
      };
      if (isFirstPage && meta?.newest_id) {
        cursorPatch.latestTweetId = meta.newest_id;
      }
      updateCursor(handle, cursorPatch);
      isFirstPage = false;

      pagesCount++;
      currentPaginationToken = meta?.next_token;

      logger.info(
        { handle, page: pagesCount, inserted: insertedPosts, duplicated: duplicatedPosts },
        'Page complete',
      );

      if (!currentPaginationToken) {
        updateCursor(handle, { backfillCompleted: 1, updatedAt: nowISO() });
        logger.info({ handle }, 'Backfill complete — no more pages');
        break;
      }

      await sleep(p.sleepMsBetweenRequests);
    }

    const finalCostUsd = pagesCount * p.maxResultsPerPage * p.estimatedPostReadCost;
    finishRun(runId, {
      status: 'success',
      finishedAt: nowISO(),
      requestedPages: pagesCount,
      fetchedPosts: insertedPosts + duplicatedPosts,
      insertedPosts,
      duplicatedPosts,
      estimatedPostReads: pagesCount * p.maxResultsPerPage,
      estimatedCostUsd: finalCostUsd,
    });

    logger.info(
      { handle, pagesCount, insertedPosts, duplicatedPosts, finalCostUsd },
      'Backfill finished successfully',
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (err instanceof ApiError) {
      if (err.status === 401) logger.error('X_BEARER_TOKEN is invalid or expired');
      else if (err.status === 404) logger.error({ handle }, 'Account not found or not accessible');
    }

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
      });
    }

    logger.error({ err }, 'backfill-account failed');
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

- [ ] **Step 3: 运行 backfill（需要真实 handle 和有效 X_BEARER_TOKEN，已在 resolve 阶段写入 DB）**

先确认 `.env` 中 `X_BEARER_TOKEN` 已填写，且该 handle 已通过 `pnpm x:resolve` 解析过。

```bash
pnpm x:backfill --max-pages 1
```

期望输出示例（每页 100 条，1 页即停止）：
```
{"level":30,"handle":"<handle>","xUserId":"<uid>","maxPages":1,"msg":"Starting backfill"}
{"level":30,"handle":"<handle>","page":1,"msg":"Fetching page"}
{"level":30,"handle":"<handle>","page":1,"inserted":N,"duplicated":0,"msg":"Page complete"}
{"level":30,"handle":"<handle>","pagesCount":1,...,"msg":"Backfill finished successfully"}
```
（1 页后 status 为 `stopped_by_page_limit`）

- [ ] **Step 4: 验证数据已写入 DB**

```bash
npx tsx -e "
const { getPostsByHandle } = require('./src/services/post-service');
const { getCursor } = require('./src/services/cursor-service');
const { getLatestRun } = require('./src/services/run-log-service');
const handle = process.argv[1];
const posts = getPostsByHandle(handle, { limit: 5 });
console.log('posts count (first 5 shown):', posts.length);
console.log('sample post:', JSON.stringify(posts[0], null, 2));
console.log('cursor:', getCursor(handle));
console.log('latest_run:', getLatestRun(handle));
" aleabitoreddit
```

期望：
- `posts.length > 0`，sample post 有 `tweetId`、`text`、`url`
- `cursor.lastPaginationToken` 不为 null（还有更多页）或 `backfillCompleted = 1`
- `latest_run.status` 为 `stopped_by_page_limit` 或 `success`

- [ ] **Step 5: Commit**

```bash
git add src/jobs/backfill-account.ts
git commit -m "feat: add backfill-account job (paginated timeline fetch, cursor persistence, cost protection)"
```

---

## 完成标准

- `npx tsc --noEmit` 零错误
- Task 1 smoke test 输出 `post-service ok`
- Task 2 smoke test 输出 `updateCursor ok`
- `pnpm x:backfill --max-pages 1` 成功后：
  - `x_posts` 有数据，`authorHandle` = 目标 handle
  - `fetch_cursors` 有该 handle 记录，`last_pagination_token` 或 `backfill_completed`
  - `fetch_runs` 最新一条 `status` 为 `stopped_by_page_limit` 或 `success`
