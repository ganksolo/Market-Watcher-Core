# Phase 4 Design Spec: post-service + backfill-account

## Goal

实现 `post-service`（x_posts 写入/查询）、为 `cursor-service` 补充 `updateCursor`，以及 `backfill-account` job：分页拉取指定账号的历史 timeline，写入 SQLite，支持断点续传与成本保护。

---

## File Map

| 操作 | 路径 | 职责 |
|---|---|---|
| 新建 | `src/services/post-service.ts` | `upsertPost()` + `getPostsByHandle()` |
| 修改 | `src/services/cursor-service.ts` | 新增 `updateCursor()` |
| 新建 | `src/jobs/backfill-account.ts` | CLI 入口：分页拉取、存储、cursor 管理、成本保护 |

---

## post-service.ts

```typescript
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
}): { inserted: boolean }
```

- `INSERT INTO x_posts ... ON CONFLICT (tweet_id) DO NOTHING`
- 返回 `{ inserted: true }` 表示新插入，`{ inserted: false }` 表示跳过（已存在）
- 调用方使用返回值累加 `insertedPosts` / `duplicatedPosts` 计数

```typescript
export function getPostsByHandle(
  handle: string,
  opts?: { limit?: number; offset?: number }
): typeof xPosts.$inferSelect[]
```

---

## cursor-service.ts（补充）

```typescript
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
): void
// db.update(fetchCursors).set(patch).where(eq(fetchCursors.accountHandle, handle)).run()
```

---

## backfill-account.ts 执行流程

```
resolveHandle() → handle
读 config/fetch-policy.json → policy
--max-pages 参数（可选，默认 policy.maxPagesPerRun）

getCursor(handle)
  → if backfillCompleted = 1: log + exit 0（已完成，无需重跑）

getWatchAccount(handle)
  → if !xUserId: error "请先运行 pnpm x:resolve"

let runId = undefined
try {
  runId = createRun('backfill', handle, now)

  构建初始 API params：
    max_results = policy.maxResultsPerPage
    tweet.fields = "id,text,created_at,author_id,conversation_id,
                    in_reply_to_user_id,lang,public_metrics,referenced_tweets"
    exclude = [
      ...(policy.includeRetweets ? [] : ['retweets']),
      ...(policy.includeReplies  ? [] : ['replies']),
    ].join(',') || undefined
    pagination_token = cursor.lastPaginationToken ?? undefined（断点续传）

  let pagesCount = 0, insertedPosts = 0, duplicatedPosts = 0
  let currentPaginationToken = cursor.lastPaginationToken ?? undefined
  let isFirstPage = !currentPaginationToken

  while (true) {
    // 成本检查（每页前）
    const estimatedCostSoFar = pagesCount * policy.maxResultsPerPage * policy.estimatedPostReadCost
    if (estimatedCostSoFar >= policy.maxEstimatedCostPerRun) {
      finishRun(runId, { status: 'stopped_by_cost_limit', ... })
      exit 0
    }

    // 页数检查
    if (pagesCount >= maxPages) {
      finishRun(runId, { status: 'stopped_by_page_limit', ... })
      exit 0
    }

    // 拉取一页
    const response = await client.get(`/2/users/${xUserId}/tweets`, params)

    const tweets = response.data ?? []
    const meta = response.meta

    for (const tweet of tweets) {
      // quotes 过滤（API 不支持，代码层过滤）
      if (!policy.includeQuotes && tweet.referenced_tweets?.[0]?.type === 'quoted') continue

      const result = upsertPost({
        tweetId: tweet.id,
        authorId: tweet.author_id ?? xUserId,
        authorHandle: handle,
        text: tweet.text,
        lang: tweet.lang ?? null,
        createdAt: tweet.created_at ?? now,
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
        firstFetchedAt: now,
        lastFetchedAt: now,
      })
      result.inserted ? insertedPosts++ : duplicatedPosts++
    }

    // 更新 cursor（每页后持久化，支持断点续传）
    const cursorPatch: Parameters<typeof updateCursor>[1] = {
      lastPaginationToken: meta?.next_token ?? null,
      oldestTweetId: meta?.oldest_id ?? undefined,
      updatedAt: now,
    }
    if (isFirstPage && meta?.newest_id) {
      cursorPatch.latestTweetId = meta.newest_id
    }
    updateCursor(handle, cursorPatch)
    isFirstPage = false

    pagesCount++
    currentPaginationToken = meta?.next_token

    // 无 next_token → timeline 已到头
    if (!currentPaginationToken) {
      updateCursor(handle, { backfillCompleted: 1, updatedAt: now })
      break
    }

    await sleep(policy.sleepMsBetweenRequests)
  }

  finishRun(runId, {
    status: 'success',
    finishedAt: now,
    requestedPages: pagesCount,
    fetchedPosts: insertedPosts + duplicatedPosts,
    insertedPosts,
    duplicatedPosts,
    estimatedPostReads: pagesCount * policy.maxResultsPerPage,
    estimatedCostUsd: pagesCount * policy.maxResultsPerPage * policy.estimatedPostReadCost,
  })
} catch (err) {
  // ApiError 401 → log 具体错误
  // finishRun(failed) if runId !== undefined
  // exit 1
}
```

---

## 字段映射：XTweet → x_posts

| x_posts 字段 | 来源 |
|---|---|
| `tweetId` | `tweet.id` |
| `authorId` | `tweet.author_id ?? xUserId` |
| `authorHandle` | job 层 `handle` |
| `text` | `tweet.text` |
| `lang` | `tweet.lang ?? null` |
| `createdAt` | `tweet.created_at ?? now` |
| `conversationId` | `tweet.conversation_id ?? null` |
| `inReplyToUserId` | `tweet.in_reply_to_user_id ?? null` |
| `referencedType` | `tweet.referenced_tweets?.[0]?.type ?? null` |
| `referencedTweetId` | `tweet.referenced_tweets?.[0]?.id ?? null` |
| `likeCount` | `tweet.public_metrics?.like_count ?? null` |
| `replyCount` | `tweet.public_metrics?.reply_count ?? null` |
| `repostCount` | `tweet.public_metrics?.retweet_count ?? null` |
| `quoteCount` | `tweet.public_metrics?.quote_count ?? null` |
| `bookmarkCount` | `tweet.public_metrics?.bookmark_count ?? null` |
| `impressionCount` | `tweet.public_metrics?.impression_count ?? null` |
| `url` | `https://x.com/${handle}/status/${tweet.id}` |
| `rawJson` | `JSON.stringify(tweet)` |
| `firstFetchedAt` | `now`（INSERT 时赋值，冲突时不更新） |
| `lastFetchedAt` | `now`（同上） |

---

## 完成标准

- `npx tsc --noEmit` 零错误
- `upsertPost` smoke test：插入 → 查询确认存在；重复插入 → 返回 `inserted: false`
- `updateCursor` smoke test：更新后 getCursor 反映新值
- `pnpm x:backfill --handle <handle>` 成功后：
  - `x_posts` 有数据，`fetch_cursors.backfill_completed = 1`（或有 `last_pagination_token` 表示分页中）
  - `fetch_runs` 最新一条 `status = 'success'`（或 `stopped_by_page_limit`）
