# Phase 5 Design Spec: sync-account job

## Goal

实现 `sync-account` job：以 `cursor.latestTweetId` 为锚点，通过 `since_id` 参数增量拉取该账号的新推文，写入 SQLite，并在所有页完成后原子更新 cursor。

---

## File Map

| 操作 | 路径 | 职责 |
|---|---|---|
| 新建 | `src/jobs/sync-account.ts` | CLI 入口：增量同步 |

不需要新 service、不需要修改 schema 或 migrate.ts。

---

## 前提检查

启动时按顺序检查，任一失败立即 `process.exit(1)`：

1. `getCursor(handle)` — 若无 cursor 或 `!cursor.latestTweetId` → error "backfill 未完成，请先运行 `pnpm x:backfill`"
2. `getWatchAccount(handle)` — 若 `!account.xUserId` → error "请先运行 `pnpm x:resolve`"

`latestTweetId` 由 backfill 第一页写入，是 sync 的唯一锚点依赖。

---

## sync-account.ts 执行流程

```
resolveHandle() → handle
读 config/fetch-policy.json → policy
--max-pages（可选，默认 policy.maxPagesPerRun）

前提检查（见上）

let runId: number | undefined = undefined

try {
  runId = createRun('sync', handle, nowISO())
  client = createXApiClient()

  构建初始 API params：
    'tweet.fields' = TWEET_FIELDS
    max_results    = String(policy.maxResultsPerPage)
    since_id       = cursor.latestTweetId          ← 增量锚点
    exclude        = retweets/replies（按 policy）
    (不传 pagination_token)

  let pagesCount = 0
  let insertedPosts = 0, duplicatedPosts = 0
  let newestId: string | undefined = undefined     ← 第一页记录
  let currentPaginationToken: string | undefined

  while (true) {
    // 成本检查（与 backfill 相同：下一页预估费用 > 上限则停止）
    const estimatedCostIfWeGoAhead = (pagesCount + 1) * policy.maxResultsPerPage * policy.estimatedPostReadCost
    if (estimatedCostIfWeGoAhead > policy.maxEstimatedCostPerRun) {
      finishRun(runId, { status: 'stopped_by_cost_limit', ... })
      return
    }

    // 页数检查
    if (pagesCount >= maxPages) {
      finishRun(runId, { status: 'stopped_by_page_limit', ... })
      return
    }

    const params = { ...baseParams }
    if (currentPaginationToken) params.pagination_token = currentPaginationToken

    logger.info({ handle, page: pagesCount + 1 }, 'Fetching sync page')

    const response = await client.get<XApiListResponse<XTweet>>(
      `/users/${xUserId}/tweets`, params
    )

    const tweets = response.data ?? []
    const meta   = response.meta

    // 第一页 0 条 → 已是最新
    if (pagesCount === 0 && tweets.length === 0) {
      finishRun(runId, { status: 'success', finishedAt: nowISO(), ... 0 counts })
      logger.info({ handle }, 'Already up to date')
      return
    }

    // 第一页记录 newestId（本次 sync 最新推文 ID）
    if (pagesCount === 0 && meta?.newest_id) {
      newestId = meta.newest_id
    }

    const pageNow = nowISO()
    for (const tweet of tweets) {
      if (!policy.includeQuotes && tweet.referenced_tweets?.[0]?.type === 'quoted') continue
      const result = upsertPost({ ...映射同 backfill... })
      result.inserted ? insertedPosts++ : duplicatedPosts++
    }

    pagesCount++
    currentPaginationToken = meta?.next_token

    logger.info({ handle, page: pagesCount, inserted: insertedPosts, duplicated: duplicatedPosts }, 'Page complete')

    if (!currentPaginationToken) break

    await sleep(policy.sleepMsBetweenRequests)
  }

  // 所有页完成后，原子更新 latestTweetId
  if (newestId) {
    updateCursor(handle, { latestTweetId: newestId, updatedAt: nowISO() })
  }

  finishRun(runId, { status: 'success', finishedAt: nowISO(), ... stats })
  logger.info({ handle, pagesCount, insertedPosts, duplicatedPosts }, 'Sync finished successfully')

} catch (err) {
  // ApiError 401 → log "token 无效"
  // ApiError 404 → log "账号不可访问"
  // finishRun(failed) if runId !== undefined
  // process.exit(1)
}
```

---

## 与 backfill 的关键区别

| | backfill | sync |
|---|---|---|
| 锚点参数 | `pagination_token`（断点续传） | `since_id = latestTweetId` |
| cursor 更新 | 每页后立即更新（crash recovery） | 所有页完成后一次性更新（原子） |
| 崩溃恢复 | 靠 `lastPaginationToken` 续传 | 重跑即可（`latestTweetId` 未变） |
| 0 条结果处理 | 标记 `backfillCompleted = 1` | 提前退出，status = `success` |
| run type | `'backfill'` | `'sync'` |

---

## 字段映射（与 backfill 完全相同）

| x_posts 字段 | 来源 |
|---|---|
| `tweetId` | `tweet.id` |
| `authorId` | `tweet.author_id ?? xUserId` |
| `authorHandle` | `handle` |
| `text` | `tweet.text` |
| `lang` | `tweet.lang ?? null` |
| `createdAt` | `tweet.created_at ?? pageNow` |
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
| `url` | `` `https://x.com/${handle}/status/${tweet.id}` `` |
| `rawJson` | `JSON.stringify(tweet)` |
| `firstFetchedAt` | `pageNow` |
| `lastFetchedAt` | `pageNow` |

---

## 完成标准

- `npx tsc --noEmit` 零错误
- `pnpm x:sync` 成功后：
  - 若有新推文：`x_posts` 有新数据，`fetch_cursors.latest_tweet_id` 已更新
  - 若无新推文：log "Already up to date"，`fetch_runs` status = `success`，cursor 不变
