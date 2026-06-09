# Phase 6 Design Spec: export-daily-raw & status jobs

## Goal

实现两个 CLI job：
1. `export-daily-raw` — 将指定日期的推文导出为 ndjson（原始 API JSON）和 markdown，并写入 `raw_archives` 记录
2. `status` — 打印账号抓取状态（帖数、cursor、最近 run）

---

## File Map

| 操作 | 路径 | 职责 |
|---|---|---|
| 修改 | `src/services/post-service.ts` | 新增 `getPostsByHandleAndDate(handle, date)` |
| 创建 | `src/jobs/export-daily-raw.ts` | 导出指定日期推文 → ndjson + markdown + rawArchives |
| 创建 | `src/jobs/status.ts` | 打印账号抓取状态 |

不新增 service 文件，不修改 schema，不修改 migrate.ts。

---

## Data Flow

```
export-daily-raw:
  DB (x_posts, created_at LIKE 'YYYY-MM-DD%') → ndjson → exports/raw/{handle}/{date}.ndjson
                                               → markdown → exports/daily/{handle}/{date}.md
                                               → rawArchives (INSERT OR IGNORE)

status:
  DB (x_posts count, fetch_cursors, fetch_runs latest) → stdout
```

---

## Section 1: post-service.ts — getPostsByHandleAndDate

```typescript
export function getPostsByHandleAndDate(handle: string, date: string) {
  return db
    .select()
    .from(xPosts)
    .where(and(eq(xPosts.authorHandle, handle), like(xPosts.createdAt, `${date}%`)))
    .orderBy(asc(xPosts.createdAt))
    .all();
}
```

- `date` 格式为 `YYYY-MM-DD`，用 `LIKE` 前缀匹配 UTC 日期
- 按 `created_at` ASC 排序

---

## Section 2: export-daily-raw.ts

### 入参

```bash
pnpm x:export:daily --handle <handle> --date YYYY-MM-DD
```

`--date` 必填。

### 前提检查

1. `--date` 格式验证（`/^\d{4}-\d{2}-\d{2}$/`）→ 格式错误时 `logger.error` + `process.exit(1)`
2. `getWatchAccount(handle)` → 账号不存在时 `logger.error` + `process.exit(1)`

### 主流程

```
posts = getPostsByHandleAndDate(handle, date)

if posts.length === 0:
  logger.info { handle, date } 'No posts for this date'
  return  // 不写文件，不写 rawArchives

// 确保目录存在
fs.mkdirSync('exports/raw/{handle}', { recursive: true })
fs.mkdirSync('exports/daily/{handle}', { recursive: true })

// 写 ndjson
ndjsonPath = 'exports/raw/{handle}/{date}.ndjson'
每行写入 post.rawJson（原始 X API JSON）

// 写 markdown
mdPath = 'exports/daily/{handle}/{date}.md'
header: # @{handle} — {date} ({posts.length} posts)
每条推文：
  time = post.createdAt 的 HH:MM（UTC）
  text = post.text，超过 280 字符截断为 277 + '...'
  line: - {time} [↗]({post.url}) {text}

// 写 rawArchives
db.insert(rawArchives)
  .values({
    accountHandle: handle,
    archiveDate: date,
    filePath: ndjsonPath,
    postCount: posts.length,
    createdAt: nowISO(),
  })
  .onConflictDoNothing()
  .run()

logger.info { handle, date, postCount: posts.length, ndjsonPath, mdPath } 'Export complete'
```

### 无 run log

export 是纯只读 + 文件写入，不写 `fetch_runs`。

---

## Section 3: status.ts

### 入参

```bash
pnpm x:status --handle <handle>
```

### 数据来源

| 字段 | 来源 |
|---|---|
| handle、xUserId | `getWatchAccount(handle)` |
| latestTweetId、oldestTweetId、backfillCompleted | `getCursor(handle)` |
| 最近 run | `getLatestRun(handle)` |
| 帖总数 | `db.select(count()).from(xPosts).where(eq(xPosts.authorHandle, handle)).get()` |

### 输出格式

```
Account:   @{handle}
User ID:   {xUserId ?? 'not resolved'}
Posts:     {count} total
Backfill:  {backfillCompleted === 1 ? 'completed ✓' : latestTweetId ? 'in progress' : 'not started'}
Latest:    {latestTweetId ?? 'n/a'}
Oldest:    {oldestTweetId ?? 'n/a'}

Last run:  {runType} · {status} · {insertedPosts} inserted · {startedAt}
           // 若无 run 记录：'no runs yet'
```

### 无前提检查

handle 不存在时所有字段显示 `n/a`，不 `exit 1`（方便查看未初始化账号）。

---

## 完成标准

- `npx tsc --noEmit` 零错误
- `pnpm x:export:daily --handle <h> --date YYYY-MM-DD`：
  - 有推文 → 生成 `.ndjson` + `.md`，`raw_archives` 有记录
  - 无推文 → log "No posts for this date"，不写文件
- `pnpm x:status --handle <h>`：正确打印账号状态，无账号时优雅显示 `n/a`
