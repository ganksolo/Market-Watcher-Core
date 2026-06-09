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
| 修改 | `src/jobs/backfill-account.ts` | 每页前检查 totalFetched >= maxPostsPerRun |
| 修改 | `src/jobs/sync-account.ts` | 同上 |
| 修改 | `src/jobs/export-daily-raw.ts` | NDJSON 封装层；Markdown 补 tweet_id、type、完整 created_at |

---

## Section 1: upsertPost 冲突策略

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
- `inserted: false` → 重复，`lastFetchedAt` 已更新
- `created_at`、`text`、`rawJson` 永不被覆盖
- 调用方（backfill / sync）的 `insertedPosts` / `duplicatedPosts` 计数逻辑不变

### 完成标准

- 重复抓取不产生重复记录
- 重复抓取后 `lastFetchedAt` 更新为最新时间
- `inserted` 判断语义可靠

---

## Section 2: maxPostsPerRun 检查

### 设计

**backfill-account.ts** 和 **sync-account.ts** 在 while 循环顶部，紧跟现有"页数检查"之后，加对称的帖子数量检查：

```typescript
// 读取 maxPostsPerRun（与 maxPagesPerRun 同层）
const maxPostsPerRun = p.maxPostsPerRun;

// while 循环内，成本检查 + 页数检查 + 新增帖子数检查
const totalFetched = insertedPosts + duplicatedPosts;
if (totalFetched >= maxPostsPerRun) {
  logger.info({ handle, totalFetched, maxPostsPerRun }, 'Posts limit reached');
  finishRun(runId, {
    status: 'stopped_by_posts_limit',
    finishedAt: nowISO(),
    requestedPages: pagesCount,
    fetchedPosts: totalFetched,
    insertedPosts,
    duplicatedPosts,
    estimatedPostReads: pagesCount * p.maxResultsPerPage,
    estimatedCostUsd: pagesCount * p.maxResultsPerPage * p.estimatedPostReadCost,
  });
  return;
}
```

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

- 单次 run 实际抓取帖子数不会超过 `maxPostsPerRun`
- run 状态记录为 `stopped_by_posts_limit`（与现有受控停止状态对称）
- 第一页前 `totalFetched = 0`，不会误触发

---

## Section 3: Export 格式升级

### NDJSON 封装格式

每行改为从 DB 列构建的封装对象，`raw_json` 作为嵌套字段：

```typescript
const ndjsonContent = posts.map(p => JSON.stringify({
  tweet_id: p.tweetId,
  author_handle: p.authorHandle,
  created_at: p.createdAt,
  text: p.text,
  url: p.url ?? `https://x.com/${p.authorHandle}/status/${p.tweetId}`,
  public_metrics: {
    like_count: p.likeCount,
    reply_count: p.replyCount,
    retweet_count: p.repostCount,
    quote_count: p.quoteCount,
    bookmark_count: p.bookmarkCount,
    impression_count: p.impressionCount,
  },
  raw_json: JSON.parse(p.rawJson),
})).join('\n') + '\n';
```

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

- NDJSON 每行是合法 JSON，包含 `tweet_id`、`author_handle`、`created_at`、`text`、`url`、`public_metrics`、`raw_json`
- Markdown 每条包含完整时间戳、tweet_id、url、type、text
- Agent 可直接读取 NDJSON，无需二次拼装
- 旧导出文件不受影响（只影响后续新导出）
