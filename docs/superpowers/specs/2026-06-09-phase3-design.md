# Phase 3 Design: Services Layer + Resolve Account Job

**Date:** 2026-06-09
**Scope:** `src/services/account-service.ts`, `src/services/cursor-service.ts`, `src/services/run-log-service.ts`, `src/jobs/resolve-account.ts`

---

## 1. 设计原则

Services 采用**薄 DB 层**方案：每个 service 只做 Drizzle 查询封装，不含业务逻辑。字段映射和参数组装由 job 层负责，service 不依赖 `XApiTypes`。

`post-service` 推迟到 Phase 4（backfill 才需要）。

---

## 2. `src/services/account-service.ts`

操作 `watch_accounts` 和 `x_users` 两张表。

```typescript
// watch_accounts —— 已存在时只更新 x_user_id + lastCheckedAt + updatedAt
upsertWatchAccount(handle: string, xUserId: string, updatedAt: string): void

// 读取单条记录
getWatchAccount(handle: string): typeof watchAccounts.$inferSelect | undefined

// x_users —— 每次 resolve 全量 upsert（刷新用户资料快照）
upsertXUser(params: {
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
}): void
```

`upsertWatchAccount` 逻辑：
- 不存在 → INSERT（createdAt = updatedAt）
- 已存在 → UPDATE 仅 `x_user_id`, `last_checked_at`, `updated_at`（保留 label/note/enabled）

---

## 3. `src/services/cursor-service.ts`

操作 `fetch_cursors` 表。

```typescript
// 不存在才插入，已存在完全跳过（保留 backfill 进度）
initCursor(handle: string, updatedAt: string): void

getCursor(handle: string): typeof fetchCursors.$inferSelect | undefined
```

`initCursor` 逻辑：INSERT OR IGNORE（利用 `account_handle UNIQUE` 约束）。

---

## 4. `src/services/run-log-service.ts`

操作 `fetch_runs` 表，两步式记录。

```typescript
// 插入 status='running'，返回自增 id
createRun(runType: string, handle: string, startedAt: string): number

// 更新任意字段（finishedAt、status、统计数据、errorMessage 等）
finishRun(id: number, patch: {
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
}): void

getLatestRun(handle: string): typeof fetchRuns.$inferSelect | undefined
```

---

## 5. `src/jobs/resolve-account.ts`

**入口**：`pnpm x:resolve --handle <handle>`

### 流程

```
dotenv.config()
requireArg('handle') → handle

createRun('resolve_user', handle, nowISO()) → runId

createXApiClient()

GET /2/users/by/username/{handle}
  ?user.fields=id,name,username,description,location,
               verified,verified_type,public_metrics,created_at
  → XApiResponse<XUser>

if (response.errors || !response.data) → throw Error

upsertWatchAccount(handle, user.id, nowISO())
upsertXUser({ xUserId: user.id, username, name, ..., rawJson: JSON.stringify(response), fetchedAt: nowISO() })
initCursor(handle, nowISO())

finishRun(runId, {
  status: 'success',
  finishedAt: nowISO(),
  estimatedUserReads: 1,
  estimatedCostUsd: 0.01   // fetch-policy estimatedUserReadCost
})

logger.info({ handle, xUserId: user.id }, 'Resolved account')
```

### 错误处理

整个流程包在 `try/catch`：
```
catch (err) →
  finishRun(runId, { status: 'failed', finishedAt: nowISO(), errorMessage: err.message })
  logger.error({ err }, 'resolve-account failed')
  process.exit(1)
```

特殊错误处理（`ApiError` 的 status）：
- `401` → token 无效，打印明确提示
- `404` → handle 不存在或不可访问

### fetch-policy

从 `config/fetch-policy.json` 读取 `estimatedUserReadCost`（默认 0.01），不硬编码。

---

## 6. 决策记录

| 问题 | 决策 | 理由 |
|---|---|---|
| upsertWatchAccount 已存在时 | 只更新 xUserId + lastCheckedAt | 保留用户手动配置的 label/note/enabled |
| run-log 记录方式 | 两步式（createRun + finishRun） | 能检测异常中断（running 且 finishedAt 为空） |
| resolve 已存在 handle | 幂等覆盖 | resolve = "确保已注册"，支持重复执行 |
| initCursor 已存在时 | 完全跳过 | 保留 backfill 进度，不重置断点 |
| service 层设计 | 薄 DB 层 | 职责单一，job 控制业务逻辑 |
| post-service | 推迟到 Phase 4 | Phase 3 不需要 |
