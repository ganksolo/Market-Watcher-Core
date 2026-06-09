# Phase 7b Design: Closure Fixes (Higher-Risk)

## Goal

修复三个 P0 剩余问题，完成第一阶段收口：
1. `upsertPost` 冲突策略（重复抓取时更新 `lastFetchedAt`）
2. `maxPostsPerRun` 真正生效（每页前检查帖子数量限制）
3. Raw export 格式升级（NDJSON 封装层 + Markdown 补全字段）

---

## Scope

- 不改 schema / migrate.ts（所有字段已存在）
- 不改 `fetch-policy.json`（`maxPostsPerRun: 1000` 已配置）
- 不处理旧导出文件的格式迁移（新格式只影响后续导出）

---

## Architecture

修改范围：
- `src/services/post-service.ts` — upsertPost 冲突策略
- `src/jobs/backfill-account.ts` — maxPostsPerRun 检查
- `src/jobs/sync-account.ts` — maxPostsPerRun 检查
- `src/jobs/export-daily-raw.ts` — NDJSON + Markdown 格式升级

---

## File Map

| 操作 | 文件 | 改动内容 |
|---|---|---|
| 修改 | `src/services/post-service.ts` | upsertPost 改为 INSERT + 失败时 UPDATE lastFetchedAt |
| 修改 | `src/jobs/backfill-account.ts` | 页前裁剪 max_results + remaining <= 0 时停止 |
| 修改 | `src/jobs/sync-account.ts` | 同上 |
| 修改 | `src/jobs/export-daily-raw.ts` | NDJSON 封装层；Markdown 补 tweet_id、type、完整 created_at |

---

## Section 1: upsertPost 冲突策略

### 阶段目标说明

Phase 7b 只补齐 freshness 字段（`lastFetchedAt`），保持低风险。metrics 更新（like/reply/repost 等）不在本阶段处理，延后到后续 phase。这是有意降级：P0 原始目标为"必要时更新 metrics"，本阶段完成其中最小子集。

### 设计

`src/services/post-service.ts` 改为两步操作：先 INSERT（`onConflictDoNothing`），失败时单独 UPDATE `lastFetchedAt`。

```typescript
export function upsertPost(params: { ... }): { inserted: boolean } {
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
}
```

`eq` 已在现有 imports 中（`import { eq, and, like, asc } from 'drizzle-orm'`），无需新增导入。

### 语义

- `inserted: true` → 新记录，`insertResult.changes === 1`
- `inserted: false` → 重复，`lastFetchedAt` 已更新为本次抓取时间
- `created_at`、`text`、`rawJson`、metrics 字段永不被覆盖
- 调用方（backfill / sync）的 `insertedPosts` / `duplicatedPosts` 计数逻辑不变

### 完成标准

- 重复抓取不产生重复记录
- 重复抓取后 `lastFetchedAt` 更新为最新时间
- `inserted` 判断语义可靠

---

## Section 2: maxPostsPerRun 检查

### totalFetched 定义

```
totalFetched = insertedPosts + duplicatedPosts
```

表示"本次 run 从 API 成功读取并处理的推文条数"（无论新增还是重复）。与数据库新增数（`insertedPosts`）和成本计量（`estimatedPostReads`）是不同概念。

### 设计：页前裁剪 + 动态 max_results

**关键思路**：不只是在超限前停止，而是将最后一页的 `max_results` 裁剪到剩余配额，从而保证总量精确不超上限。

```typescript
// while 循环内，每页请求前执行
const totalFetched = insertedPosts + duplicatedPosts;
const remaining = maxPostsPerRun - totalFetched;
// X API GET /2/users/:id/tweets 要求 max_results >= 5
const API_MIN_RESULTS = 5;

if (remaining <= 0 || remaining < API_MIN_RESULTS) {
  // remaining <= 0: 已达上限；remaining < 5: 剩余配额不满 X API 最小值，无法发请求
  logger.info({ handle, totalFetched, maxPostsPerRun, remaining }, 'Posts limit reached');
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

// 动态裁剪本页请求量
const actualMaxResults = Math.min(p.maxResultsPerPage, remaining);
params['max_results'] = String(actualMaxResults);

// 成本检查：基于 actualMaxResults（而非固定 maxResultsPerPage）
const estimatedCostIfWeGoAhead =
  (totalEstimatedPostReads + actualMaxResults) * p.estimatedPostReadCost;
if (estimatedCostIfWeGoAhead > p.maxEstimatedCostPerRun) {
  logger.info({ handle, estimatedCostIfWeGoAhead, maxEstimatedCostPerRun: p.maxEstimatedCostPerRun }, 'Cost limit reached');
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

totalEstimatedPostReads += actualMaxResults;
```

- `totalEstimatedPostReads` 在循环外初始化为 `0`，每页累加 `actualMaxResults`（替代现有的 `pagesCount * p.maxResultsPerPage`）
- 停止条件有两个：`remaining < API_MIN_RESULTS`（剩余配额不足 X API 最小值 5）或 `remaining <= 0`（已满），均记为 `stopped_by_posts_limit`
- 循环外旧的成本预检（基于固定 `maxResultsPerPage` 粗算）**删除**，由循环内精确检查完全替代；成本检查基于 `totalEstimatedPostReads + actualMaxResults`，超限时记为 `stopped_by_cost_limit` 并 return
- `finishRun` 的成功路径改用 `totalEstimatedPostReads`，现有各 `stopped_by_*` 路径同步修改

### policy 类型声明

两个 job 内的 `policy` 类型声明需补充 `maxPostsPerRun: number`：

```typescript
const policy: {
  default: {
    maxResultsPerPage: number;
    maxPagesPerRun: number;
    maxPostsPerRun: number;   // 新增
    // ... 其余字段不变
  };
} = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
```

### 完成标准

- 单次 run 实际处理的推文条数严格不超过 `maxPostsPerRun`
- 最后一页会主动裁剪 `max_results`，而非等到下页才停止
- 剩余配额 `< 5`（X API 最小值）时直接停止，不发送非法请求
- run 状态记录为 `stopped_by_posts_limit`（与现有受控停止状态对称）
- 成本检查基于 `totalEstimatedPostReads + actualMaxResults`，每页动态计算
- `estimatedPostReads` 反映实际请求量之和，而非固定的 `pagesCount × maxResultsPerPage`

---

## Section 3: Export 格式升级

### NDJSON 封装格式

每行改为从 DB 列构建的封装对象，`raw_json` 作为嵌套字段：

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

`JSON.parse(p.rawJson)` 解析失败时抛出错误，由外层 `try-catch` 捕获并 `process.exit(1)`（与现有导出错误处理一致）。DB 内 `rawJson` 由 API 响应写入，正常情况下不会损坏，此处做显式保护。

### Markdown 格式

每条 post 在现有基础上补全 `created_at`（完整 ISO）、`tweet_id`（代码格式）、`type`：

```typescript
const type = p.referencedType ?? 'tweet';
const url = p.url ?? `https://x.com/${p.authorHandle}/status/${p.tweetId}`;
const rawText = p.text.replace(/\n/g, ' ');
const text = rawText.length > 280 ? rawText.slice(0, 277) + '...' : rawText;
lines.push(`- ${p.createdAt} \`${p.tweetId}\` [↗](${url}) [${type}] ${text}`);
```

示例输出：
```
- 2026-06-09T14:32:00.000Z `2064223473929752811` [↗](https://x.com/...) [tweet] some text here
```

### 完成标准

- NDJSON 每行是合法 JSON，包含 `tweet_id`、`author_handle`、`created_at`、`text`、`url`、`type`、`referenced_tweet_id`、`public_metrics`、`raw_json`
- Markdown 每条包含完整时间戳、tweet_id、url、type、text
- Agent 可直接读取 NDJSON，无需二次拼装
- 旧导出文件不受影响（只影响后续新导出）
