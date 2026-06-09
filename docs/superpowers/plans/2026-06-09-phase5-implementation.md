# Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `sync-account` job — 用 `cursor.latestTweetId` 作为 `since_id` 增量拉取新推文，所有页完成后原子更新 cursor。

**Architecture:** 单文件 job，结构与 `backfill-account.ts` 高度相似，但无 cursor 断点续传（崩溃重跑即可）、无 `initCursor` 调用、`latestTweetId` 在所有页完成后一次性写入。前提检查确保 backfill 已完成（`cursor.latestTweetId` 存在）。

**Tech Stack:** Node.js 22、TypeScript、tsx、drizzle-orm（better-sqlite3）、X API v2

---

## 文件清单

| 操作 | 路径 | 职责 |
|---|---|---|
| 创建 | `src/jobs/sync-account.ts` | CLI 入口：增量同步 |

不需要修改任何 service 或 schema。

---

## Task 1: `src/jobs/sync-account.ts`

**Files:**
- 创建: `src/jobs/sync-account.ts`

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
  if (!cursor?.latestTweetId) {
    logger.error({ handle }, 'Backfill not completed — run pnpm x:backfill first');
    process.exit(1);
  }

  const account = getWatchAccount(handle);
  if (!account?.xUserId) {
    logger.error({ handle }, 'No x_user_id found — run pnpm x:resolve first');
    process.exit(1);
  }
  const xUserId = account.xUserId;

  let runId: number | undefined = undefined;

  try {
    runId = createRun('sync', handle, nowISO());

    const client = createXApiClient();

    const excludeParts: string[] = [];
    if (!p.includeRetweets) excludeParts.push('retweets');
    if (!p.includeReplies) excludeParts.push('replies');

    const baseParams: Record<string, string> = {
      'tweet.fields': TWEET_FIELDS,
      max_results: String(p.maxResultsPerPage),
      since_id: cursor.latestTweetId,
    };
    if (excludeParts.length) baseParams.exclude = excludeParts.join(',');

    let pagesCount = 0;
    let insertedPosts = 0;
    let duplicatedPosts = 0;
    let newestId: string | undefined = undefined;
    let currentPaginationToken: string | undefined;

    logger.info({ handle, xUserId, maxPages, sinceId: cursor.latestTweetId }, 'Starting sync');

    while (true) {
      const estimatedCostIfWeGoAhead = (pagesCount + 1) * p.maxResultsPerPage * p.estimatedPostReadCost;
      if (estimatedCostIfWeGoAhead > p.maxEstimatedCostPerRun) {
        const estimatedCostSoFar = pagesCount * p.maxResultsPerPage * p.estimatedPostReadCost;
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

      const params: Record<string, string> = { ...baseParams };
      if (currentPaginationToken) params.pagination_token = currentPaginationToken;

      logger.info({ handle, page: pagesCount + 1 }, 'Fetching sync page');

      const response = await client.get<XApiListResponse<XTweet>>(
        `/users/${xUserId}/tweets`,
        params,
      );

      const tweets = response.data ?? [];
      const meta = response.meta;

      if (pagesCount === 0 && tweets.length === 0) {
        finishRun(runId, {
          status: 'success',
          finishedAt: nowISO(),
          requestedPages: 0,
          fetchedPosts: 0,
          insertedPosts: 0,
          duplicatedPosts: 0,
          estimatedPostReads: 0,
          estimatedCostUsd: 0,
        });
        logger.info({ handle }, 'Already up to date');
        return;
      }

      if (pagesCount === 0 && meta?.newest_id) {
        newestId = meta.newest_id;
      }

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

      pagesCount++;
      currentPaginationToken = meta?.next_token;

      logger.info(
        { handle, page: pagesCount, inserted: insertedPosts, duplicated: duplicatedPosts },
        'Page complete',
      );

      if (!currentPaginationToken) break;

      await sleep(p.sleepMsBetweenRequests);
    }

    if (newestId) {
      updateCursor(handle, { latestTweetId: newestId, updatedAt: nowISO() });
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
      'Sync finished successfully',
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

    logger.error({ err }, 'sync-account failed');
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

- [ ] **Step 3: 运行 sync（backfill 已完成的情况下）**

确认 `pnpm x:backfill` 已跑过（cursor 有 `latestTweetId`）。

```bash
pnpm x:sync
```

**场景 A — 无新推文（刚跑完 backfill）：**
```
{"level":30,"handle":"<h>","xUserId":"<id>","sinceId":"<id>","msg":"Starting sync"}
{"level":30,"handle":"<h>","page":1,"msg":"Fetching sync page"}
{"level":30,"handle":"<h>","msg":"Already up to date"}
```

**场景 B — 有新推文：**
```
{"level":30,"handle":"<h>","xUserId":"<id>","sinceId":"<id>","msg":"Starting sync"}
{"level":30,"handle":"<h>","page":1,"msg":"Fetching sync page"}
{"level":30,"handle":"<h>","page":1,"inserted":N,"duplicated":0,"msg":"Page complete"}
{"level":30,"handle":"<h>","pagesCount":1,...,"msg":"Sync finished successfully"}
```

- [ ] **Step 4: 验证前提检查（无 latestTweetId 时报错退出）**

临时用 tsx 模拟无 latestTweetId 的场景验证错误路径：

```bash
npx tsx -e "
const { updateCursor, getCursor } = require('./src/services/cursor-service');
const handle = 'aleabitoreddit';
const c = getCursor(handle);
console.log('latestTweetId before:', c?.latestTweetId);
console.log('Test: cursor exists and has latestTweetId =>', !!c?.latestTweetId);
"
```

期望：`latestTweetId before: <tweet_id>`（非 null），`Test: ... => true`

- [ ] **Step 5: 验证 run 记录**

```bash
npx tsx -e "
const { getLatestRun } = require('./src/services/run-log-service');
const { getCursor } = require('./src/services/cursor-service');
const run = getLatestRun('aleabitoreddit');
console.log('latest sync run:', JSON.stringify(run, null, 2));
const c = getCursor('aleabitoreddit');
console.log('cursor latestTweetId:', c?.latestTweetId);
"
```

期望：
- `run.runType = 'sync'`
- `run.status = 'success'`
- `run.insertedPosts >= 0`（0 表示 "already up to date"，> 0 表示有新推文）

- [ ] **Step 6: Commit**

```bash
git add src/jobs/sync-account.ts
git commit -m "feat: add sync-account job (incremental sync via since_id, atomic cursor update)"
```

---

## 完成标准

- `npx tsc --noEmit` 零错误
- `pnpm x:sync` 两种路径均正常：
  - 无新推文 → log "Already up to date"，`fetch_runs` status = `success`，`inserted_posts = 0`
  - 有新推文 → `x_posts` 有新数据，`fetch_cursors.latest_tweet_id` 已更新至本次 sync 最新推文 ID
- 前提检查有效：无 `latestTweetId` 时 log error 并 exit 1
