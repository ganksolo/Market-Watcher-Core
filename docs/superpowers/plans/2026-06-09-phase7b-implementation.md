# Phase 7b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复三个 P0 收口问题：upsertPost 冲突时补写 lastFetchedAt、maxPostsPerRun 在 backfill/sync 中真正生效、export 格式升级为 Agent 可直接消费。

**Architecture:** 修改 4 个文件，零 schema 变更。`post-service.ts` 改为两步写入（INSERT + 冲突时 UPDATE）；backfill/sync 删除旧循环外成本预检，改为循环内基于 `actualMaxResults` 的精确检查，并补充 posts 数量上限检查；`export-daily-raw.ts` 将 NDJSON 从直接输出 rawJson 升级为封装对象，Markdown 补全 tweet_id / type / 完整 created_at。

**Tech Stack:** Node.js 22、TypeScript、tsx、drizzle-orm（better-sqlite3），无测试套件，验证方式为 `npx tsc --noEmit` + CLI 手动运行。

---

## 文件清单

| 操作 | 文件 | 改动内容 |
|---|---|---|
| 修改 | `src/services/post-service.ts` | upsertPost：INSERT onConflictDoNothing，冲突时 UPDATE lastFetchedAt |
| 修改 | `src/jobs/backfill-account.ts` | 删除旧成本预检；补 posts 上限检查；动态 actualMaxResults；更新所有 finishRun |
| 修改 | `src/jobs/sync-account.ts` | 同上（sync 版） |
| 修改 | `src/jobs/export-daily-raw.ts` | NDJSON 封装层；Markdown 补完整 created_at / tweet_id / type |

---

## Task 1: upsertPost 冲突策略 (`src/services/post-service.ts`)

**Files:**
- 修改: `src/services/post-service.ts:27-33`

当前实现（第 27–33 行）：
```typescript
const result = db
  .insert(xPosts)
  .values(params)
  .onConflictDoNothing()
  .run();
return { inserted: result.changes > 0 };
```

问题：冲突时直接忽略，`lastFetchedAt` 永远不更新。

- [ ] **Step 1: 替换 upsertPost 实现**

将第 27–33 行替换为：

```typescript
const insertResult = db
  .insert(xPosts)
  .values(params)
  .onConflictDoNothing()
  .run();

if (insertResult.changes > 0) {
  return { inserted: true };
}

db.update(xPosts)
  .set({ lastFetchedAt: params.lastFetchedAt })
  .where(eq(xPosts.tweetId, params.tweetId))
  .run();

return { inserted: false };
```

`eq` 已在第 1 行 import，无需新增依赖。函数签名 `{ inserted: boolean }` 不变。

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误。

- [ ] **Step 3: 验证行为**

```bash
npx tsx -e "
import dotenv from 'dotenv';
dotenv.config();
import { upsertPost } from './src/services/post-service.ts';

const base = {
  tweetId: 'test_7b_upsert_001',
  authorId: 'uid_test',
  authorHandle: 'test_handle',
  text: 'hello',
  lang: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  conversationId: null,
  inReplyToUserId: null,
  referencedType: null,
  referencedTweetId: null,
  likeCount: 0,
  replyCount: 0,
  repostCount: 0,
  quoteCount: 0,
  bookmarkCount: 0,
  impressionCount: 0,
  url: 'https://x.com/test/status/test_7b_upsert_001',
  rawJson: '{\"id\":\"test_7b_upsert_001\"}',
  firstFetchedAt: '2026-01-01T00:00:00.000Z',
  lastFetchedAt: '2026-01-01T00:00:00.000Z',
};

const r1 = upsertPost(base);
console.log('first insert:', r1.inserted);   // 期望: true

const r2 = upsertPost({ ...base, lastFetchedAt: '2026-06-09T12:00:00.000Z' });
console.log('second insert (duplicate):', r2.inserted);  // 期望: false
"
```

期望输出：
```
first insert: true
second insert (duplicate): false
```

- [ ] **Step 4: Commit**

```bash
git add src/services/post-service.ts
git commit -m "fix: upsertPost — update lastFetchedAt on conflict instead of ignoring"
```

---

## Task 2: maxPostsPerRun 检查 — backfill (`src/jobs/backfill-account.ts`)

**Files:**
- 修改: `src/jobs/backfill-account.ts`

需要四处改动：
1. policy 类型声明补 `maxPostsPerRun: number`
2. 在 while 循环前加 `let totalEstimatedPostReads = 0` + `const maxPostsPerRun = p.maxPostsPerRun`
3. 将 while 循环顶部的旧成本检查（lines 78–93）替换为新的 posts 限制 + 精确成本检查，并更新 page 限制 finishRun
4. 更新成功路径的 finishRun 和 logger

- [ ] **Step 1: 补 maxPostsPerRun 到 policy 类型声明**

当前 policy 类型声明（第 27–38 行）：

```typescript
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
```

替换为：

```typescript
const policy: {
  default: {
    maxResultsPerPage: number;
    maxPagesPerRun: number;
    maxPostsPerRun: number;
    includeReplies: boolean;
    includeRetweets: boolean;
    includeQuotes: boolean;
    sleepMsBetweenRequests: number;
    estimatedPostReadCost: number;
    maxEstimatedCostPerRun: number;
  };
} = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
```

- [ ] **Step 2: 在循环前声明 totalEstimatedPostReads 和 maxPostsPerRun**

当前（第 41–42 行）：

```typescript
const p = policy.default;
const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;
```

替换为：

```typescript
const p = policy.default;
const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;
const maxPostsPerRun = p.maxPostsPerRun;
```

然后在 while 循环前（当前 `let pagesCount = 0;` 所在的 let 声明块末尾，第 67–71 行附近）：

当前：
```typescript
let pagesCount = 0;
let insertedPosts = 0;
let duplicatedPosts = 0;
let currentPaginationToken: string | undefined = cursor?.lastPaginationToken ?? undefined;
let isFirstPage = !currentPaginationToken;
```

替换为：
```typescript
let pagesCount = 0;
let insertedPosts = 0;
let duplicatedPosts = 0;
let totalEstimatedPostReads = 0;
let currentPaginationToken: string | undefined = cursor?.lastPaginationToken ?? undefined;
let isFirstPage = !currentPaginationToken;
```

- [ ] **Step 3: 替换 while 循环顶部的检查逻辑**

当前（第 78–113 行，即旧成本检查 + page 限制检查 + params 构建）：

```typescript
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

      const params: Record<string, string> = {
        'tweet.fields': TWEET_FIELDS,
        max_results: String(p.maxResultsPerPage),
      };
```

替换为：

```typescript
      // Posts limit check
      const totalFetched = insertedPosts + duplicatedPosts;
      const remaining = maxPostsPerRun - totalFetched;
      // X API GET /2/users/:id/tweets requires max_results >= 5
      const API_MIN_RESULTS = 5;
      if (remaining <= 0 || remaining < API_MIN_RESULTS) {
        logger.info({ handle, totalFetched, maxPostsPerRun }, 'Posts limit reached');
        finishRun(runId, {
          status: 'stopped_by_posts_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: totalFetched,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: totalEstimatedPostReads,
          estimatedCostUsd: totalEstimatedPostReads * p.estimatedPostReadCost,
        });
        return;
      }

      // Compute this page's request size (trimmed to remaining quota)
      const actualMaxResults = Math.min(p.maxResultsPerPage, remaining);

      // Cost check (per-page, based on actualMaxResults)
      const estimatedCostIfWeGoAhead =
        (totalEstimatedPostReads + actualMaxResults) * p.estimatedPostReadCost;
      if (estimatedCostIfWeGoAhead > p.maxEstimatedCostPerRun) {
        logger.warn({ handle, estimatedCostIfWeGoAhead, maxEstimatedCostPerRun: p.maxEstimatedCostPerRun }, 'Cost limit reached');
        finishRun(runId, {
          status: 'stopped_by_cost_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: totalFetched,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: totalEstimatedPostReads,
          estimatedCostUsd: totalEstimatedPostReads * p.estimatedPostReadCost,
        });
        return;
      }

      if (pagesCount >= maxPages) {
        logger.info({ handle, pagesCount }, 'Page limit reached');
        finishRun(runId, {
          status: 'stopped_by_page_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: totalFetched,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: totalEstimatedPostReads,
          estimatedCostUsd: totalEstimatedPostReads * p.estimatedPostReadCost,
        });
        return;
      }

      // Commit to this page
      totalEstimatedPostReads += actualMaxResults;

      const params: Record<string, string> = {
        'tweet.fields': TWEET_FIELDS,
        max_results: String(actualMaxResults),
      };
```

- [ ] **Step 4: 更新成功路径的 finishRun 和 logger**

当前（第 191–206 行）：

```typescript
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
```

替换为：

```typescript
    const finalCostUsd = totalEstimatedPostReads * p.estimatedPostReadCost;
    finishRun(runId, {
      status: 'success',
      finishedAt: nowISO(),
      requestedPages: pagesCount,
      fetchedPosts: insertedPosts + duplicatedPosts,
      insertedPosts,
      duplicatedPosts,
      estimatedPostReads: totalEstimatedPostReads,
      estimatedCostUsd: finalCostUsd,
    });

    logger.info(
      { handle, pagesCount, insertedPosts, duplicatedPosts, finalCostUsd },
      'Backfill finished successfully',
    );
```

- [ ] **Step 5: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误。

- [ ] **Step 6: Commit**

```bash
git add src/jobs/backfill-account.ts
git commit -m "fix: backfill — enforce maxPostsPerRun with page trimming, accurate per-page cost check"
```

---

## Task 3: maxPostsPerRun 检查 — sync (`src/jobs/sync-account.ts`)

**Files:**
- 修改: `src/jobs/sync-account.ts`

与 Task 2 相同的逻辑，应用于 sync-account.ts。sync 的额外特殊性：`baseParams` 在循环外声明，循环内 spread 后需用 `actualMaxResults` 覆盖 `max_results`。

- [ ] **Step 1: 补 maxPostsPerRun 到 policy 类型声明**

当前 policy 类型声明（第 27–38 行）：

```typescript
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
```

替换为：

```typescript
const policy: {
  default: {
    maxResultsPerPage: number;
    maxPagesPerRun: number;
    maxPostsPerRun: number;
    includeReplies: boolean;
    includeRetweets: boolean;
    includeQuotes: boolean;
    sleepMsBetweenRequests: number;
    estimatedPostReadCost: number;
    maxEstimatedCostPerRun: number;
  };
} = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
```

- [ ] **Step 2: 声明 maxPostsPerRun 和 totalEstimatedPostReads**

当前（第 40–41 行）：

```typescript
const p = policy.default;
const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;
```

替换为：

```typescript
const p = policy.default;
const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;
const maxPostsPerRun = p.maxPostsPerRun;
```

然后在 let 声明块（第 74–79 行）：

当前：
```typescript
let pagesCount = 0;
let insertedPosts = 0;
let duplicatedPosts = 0;
let newestId: string | undefined = undefined;
let currentPaginationToken: string | undefined;
let firstPageTweets: XTweet[] = [];
```

替换为：
```typescript
let pagesCount = 0;
let insertedPosts = 0;
let duplicatedPosts = 0;
let totalEstimatedPostReads = 0;
let newestId: string | undefined = undefined;
let currentPaginationToken: string | undefined;
let firstPageTweets: XTweet[] = [];
```

- [ ] **Step 3: 替换 while 循环顶部的检查逻辑**

当前（第 84–118 行，旧成本检查 + page 限制检查 + params 构建）：

```typescript
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
```

替换为：

```typescript
      // Posts limit check
      const totalFetched = insertedPosts + duplicatedPosts;
      const remaining = maxPostsPerRun - totalFetched;
      // X API GET /2/users/:id/tweets requires max_results >= 5
      const API_MIN_RESULTS = 5;
      if (remaining <= 0 || remaining < API_MIN_RESULTS) {
        logger.info({ handle, totalFetched, maxPostsPerRun }, 'Posts limit reached');
        finishRun(runId, {
          status: 'stopped_by_posts_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: totalFetched,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: totalEstimatedPostReads,
          estimatedCostUsd: totalEstimatedPostReads * p.estimatedPostReadCost,
        });
        return;
      }

      // Compute this page's request size (trimmed to remaining quota)
      const actualMaxResults = Math.min(p.maxResultsPerPage, remaining);

      // Cost check (per-page, based on actualMaxResults)
      const estimatedCostIfWeGoAhead =
        (totalEstimatedPostReads + actualMaxResults) * p.estimatedPostReadCost;
      if (estimatedCostIfWeGoAhead > p.maxEstimatedCostPerRun) {
        logger.warn({ handle, estimatedCostIfWeGoAhead, maxEstimatedCostPerRun: p.maxEstimatedCostPerRun }, 'Cost limit reached');
        finishRun(runId, {
          status: 'stopped_by_cost_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: totalFetched,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: totalEstimatedPostReads,
          estimatedCostUsd: totalEstimatedPostReads * p.estimatedPostReadCost,
        });
        return;
      }

      if (pagesCount >= maxPages) {
        logger.info({ handle, pagesCount }, 'Page limit reached');
        finishRun(runId, {
          status: 'stopped_by_page_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: totalFetched,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: totalEstimatedPostReads,
          estimatedCostUsd: totalEstimatedPostReads * p.estimatedPostReadCost,
        });
        return;
      }

      // Commit to this page
      totalEstimatedPostReads += actualMaxResults;

      const params: Record<string, string> = { ...baseParams };
      params.max_results = String(actualMaxResults);
      if (currentPaginationToken) params.pagination_token = currentPaginationToken;
```

- [ ] **Step 4: 更新成功路径的 finishRun 和 logger**

当前（第 203–218 行）：

```typescript
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
```

替换为：

```typescript
    const finalCostUsd = totalEstimatedPostReads * p.estimatedPostReadCost;
    finishRun(runId, {
      status: 'success',
      finishedAt: nowISO(),
      requestedPages: pagesCount,
      fetchedPosts: insertedPosts + duplicatedPosts,
      insertedPosts,
      duplicatedPosts,
      estimatedPostReads: totalEstimatedPostReads,
      estimatedCostUsd: finalCostUsd,
    });

    logger.info(
      { handle, pagesCount, insertedPosts, duplicatedPosts, finalCostUsd },
      'Sync finished successfully',
    );
```

- [ ] **Step 5: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误。

- [ ] **Step 6: Commit**

```bash
git add src/jobs/sync-account.ts
git commit -m "fix: sync — enforce maxPostsPerRun with page trimming, accurate per-page cost check"
```

---

## Task 4: Export 格式升级 (`src/jobs/export-daily-raw.ts`)

**Files:**
- 修改: `src/jobs/export-daily-raw.ts:45-55`

需要两处改动：
1. NDJSON：从 `posts.map(p => p.rawJson)` 改为封装对象，`raw_json` 作为嵌套字段
2. Markdown：从 `${time}` 改为完整 `createdAt`，补 `` `tweetId` `` 和 `[type]`

- [ ] **Step 1: 替换 NDJSON 生成逻辑**

当前（第 45 行）：
```typescript
    const ndjsonContent = posts.map(p => p.rawJson).join('\n') + '\n';
```

替换为：
```typescript
    const ndjsonContent = posts.map(p => {
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(p.rawJson);
      } catch {
        throw new Error(`Failed to parse rawJson for tweet ${p.tweetId}`);
      }
      return JSON.stringify({
        tweet_id: p.tweetId,
        author_handle: p.authorHandle,
        created_at: p.createdAt,
        text: p.text,
        url: p.url ?? `https://x.com/${p.authorHandle}/status/${p.tweetId}`,
        type: p.referencedType ?? 'tweet',
        referenced_tweet_id: p.referencedTweetId ?? null,
        public_metrics: {
          like_count: p.likeCount,
          reply_count: p.replyCount,
          retweet_count: p.repostCount,
          quote_count: p.quoteCount,
          bookmark_count: p.bookmarkCount,
          impression_count: p.impressionCount,
        },
        raw_json: parsedRaw,
      });
    }).join('\n') + '\n';
```

注：`throw new Error(...)` 会被第 36 行的外层 `try-catch` 捕获，走 `process.exit(1)`。DB 写入的 `rawJson` 来自 API 响应，正常不会损坏；此处做显式保护。

- [ ] **Step 2: 替换 Markdown 生成逻辑**

当前（第 48–55 行）：
```typescript
    const lines: string[] = [`# @${handle} — ${date} (${posts.length} posts)`, ''];
    for (const post of posts) {
      const time = post.createdAt.slice(11, 16);
      const rawText = post.text.replace(/\n/g, ' ');
      const text = rawText.length > 280 ? rawText.slice(0, 277) + '...' : rawText;
      const url = post.url ?? `https://x.com/${handle}/status/${post.tweetId}`;
      lines.push(`- ${time} [↗](${url}) ${text}`);
    }
```

替换为：
```typescript
    const lines: string[] = [`# @${handle} — ${date} (${posts.length} posts)`, ''];
    for (const post of posts) {
      const type = post.referencedType ?? 'tweet';
      const url = post.url ?? `https://x.com/${post.authorHandle}/status/${post.tweetId}`;
      const rawText = post.text.replace(/\n/g, ' ');
      const text = rawText.length > 280 ? rawText.slice(0, 277) + '...' : rawText;
      lines.push(`- ${post.createdAt} \`${post.tweetId}\` [↗](${url}) [${type}] ${text}`);
    }
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误。

- [ ] **Step 4: 验证导出格式**

确认有可导出数据：
```bash
npx tsx -e "
import dotenv from 'dotenv';
dotenv.config();
import { getPostsByHandleAndDate } from './src/services/post-service.ts';
const posts = getPostsByHandleAndDate('aleabitoreddit', '2026-06-09');
console.log('posts for 2026-06-09:', posts.length);
if (posts.length > 0) console.log('first tweetId:', posts[0].tweetId, 'createdAt:', posts[0].createdAt);
"
```

如果该日期无数据，换一个有数据的日期（从数据库确认）：
```bash
npx tsx -e "
import dotenv from 'dotenv';
dotenv.config();
import { db } from './src/db/index.ts';
import { xPosts } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';
const posts = db.select().from(xPosts).where(eq(xPosts.authorHandle, 'aleabitoreddit')).limit(3).all();
posts.forEach(p => console.log(p.createdAt.slice(0, 10), p.tweetId));
"
```

用一个有数据的日期运行导出：
```bash
pnpm x:export:daily --handle aleabitoreddit --date <YYYY-MM-DD>
```

- [ ] **Step 5: 验证 NDJSON 格式**

```bash
# 取第一行，检查字段
head -1 exports/raw/aleabitoreddit/<YYYY-MM-DD>.ndjson | npx tsx -e "
const line = require('fs').readFileSync('/dev/stdin', 'utf-8').trim();
const obj = JSON.parse(line);
const required = ['tweet_id','author_handle','created_at','text','url','type','referenced_tweet_id','public_metrics','raw_json'];
for (const k of required) {
  console.log(k + ':', k in obj ? 'OK' : 'MISSING');
}
console.log('public_metrics keys:', Object.keys(obj.public_metrics));
"
```

期望：所有字段均输出 `OK`，`public_metrics` 含 `like_count`、`reply_count`、`retweet_count`、`quote_count`、`bookmark_count`、`impression_count`。

- [ ] **Step 6: 验证 Markdown 格式**

```bash
head -5 exports/daily/aleabitoreddit/<YYYY-MM-DD>.md
```

期望：每条 post 格式为：
```
- 2026-06-09T14:32:00.000Z `2064223473929752811` [↗](https://x.com/...) [tweet] some text here
```
包含完整 ISO 时间戳、backtick 包裹的 tweet_id、可点击链接、`[type]` 标签。

- [ ] **Step 7: Commit**

```bash
git add src/jobs/export-daily-raw.ts
git commit -m "feat: export-daily-raw — NDJSON wrapped envelope, Markdown with full created_at / tweet_id / type"
```

---

## 完成标准

- `npx tsc --noEmit` 全程零错误
- 重复抓取不产生重复记录；`lastFetchedAt` 在重复时更新
- 单次 run 实际处理的推文条数严格不超过 `maxPostsPerRun`（当前配置 1000）
- 剩余配额 `< 5` 时停止并记录 `stopped_by_posts_limit`
- 成本检查基于 `totalEstimatedPostReads + actualMaxResults`，动态精确
- NDJSON 每行含 `tweet_id`、`author_handle`、`created_at`、`text`、`url`、`type`、`referenced_tweet_id`、`public_metrics`、`raw_json`
- Markdown 每条含完整时间戳、tweet_id、url、type、text
