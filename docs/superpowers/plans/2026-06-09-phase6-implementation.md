# Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `export-daily-raw` job（指定日期推文导出为 ndjson + markdown）和 `status` job（打印账号抓取状态）。

**Architecture:** 在 `post-service.ts` 新增按日期过滤的查询函数；两个 job 文件直接处理文件 I/O 和 DB 写入，无新 service 层。日期过滤使用 `LIKE 'YYYY-MM-DD%'` 匹配 UTC 时间戳前缀。

**Tech Stack:** Node.js 22、TypeScript、tsx、drizzle-orm（better-sqlite3）、Node.js `fs` 模块

---

## 文件清单

| 操作 | 路径 | 职责 |
|---|---|---|
| 修改 | `src/services/post-service.ts` | 新增 `getPostsByHandleAndDate` |
| 创建 | `src/jobs/export-daily-raw.ts` | 导出指定日期推文 → ndjson + markdown + rawArchives |
| 创建 | `src/jobs/status.ts` | 打印账号抓取状态 |

---

## Task 1: `src/services/post-service.ts` — 新增 `getPostsByHandleAndDate`

**Files:**
- 修改: `src/services/post-service.ts`

- [ ] **Step 1: 修改文件**

将 `src/services/post-service.ts` 完整替换为：

```typescript
import { eq, and, like, asc } from 'drizzle-orm';
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

export function getPostsByHandleAndDate(handle: string, date: string) {
  return db
    .select()
    .from(xPosts)
    .where(and(eq(xPosts.authorHandle, handle), like(xPosts.createdAt, `${date}%`)))
    .orderBy(asc(xPosts.createdAt))
    .all();
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: 验证函数可用**

```bash
npx tsx -e "
const { getPostsByHandleAndDate } = require('./src/services/post-service');
const posts = getPostsByHandleAndDate('aleabitoreddit', '2026-06-09');
console.log('posts on 2026-06-09:', posts.length);
if (posts.length > 0) console.log('first post:', posts[0].createdAt, posts[0].tweetId);
"
```

期望：无报错，打印帖数（0 或正整数均可）

- [ ] **Step 4: Commit**

```bash
git add src/services/post-service.ts
git commit -m "feat: add getPostsByHandleAndDate to post-service"
```

---

## Task 2: `src/jobs/export-daily-raw.ts`

**Files:**
- 创建: `src/jobs/export-daily-raw.ts`

- [ ] **Step 1: 创建文件**

```typescript
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { resolveHandle, getArg } from '../utils/cli';
import { logger } from '../utils/logger';
import { nowISO } from '../utils/date';
import { getWatchAccount } from '../services/account-service';
import { getPostsByHandleAndDate } from '../services/post-service';
import { db } from '../db';
import { rawArchives } from '../db/schema';

dotenv.config();

function main(): void {
  const handle = resolveHandle();
  const date = getArg('date');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    logger.error({ date }, 'Invalid or missing --date argument (expected YYYY-MM-DD)');
    process.exit(1);
  }

  const account = getWatchAccount(handle);
  if (!account) {
    logger.error({ handle }, 'Account not found — run pnpm x:resolve first');
    process.exit(1);
  }

  const posts = getPostsByHandleAndDate(handle, date);

  if (posts.length === 0) {
    logger.info({ handle, date }, 'No posts for this date');
    return;
  }

  const ndjsonDir = path.resolve(`exports/raw/${handle}`);
  const mdDir = path.resolve(`exports/daily/${handle}`);
  fs.mkdirSync(ndjsonDir, { recursive: true });
  fs.mkdirSync(mdDir, { recursive: true });

  const ndjsonPath = path.join(ndjsonDir, `${date}.ndjson`);
  const mdPath = path.join(mdDir, `${date}.md`);

  const ndjsonContent = posts.map(p => p.rawJson).join('\n') + '\n';
  fs.writeFileSync(ndjsonPath, ndjsonContent, 'utf-8');

  const lines: string[] = [`# @${handle} — ${date} (${posts.length} posts)`, ''];
  for (const post of posts) {
    const time = post.createdAt.slice(11, 16);
    const rawText = post.text.replace(/\n/g, ' ');
    const text = rawText.length > 280 ? rawText.slice(0, 277) + '...' : rawText;
    const url = post.url ?? `https://x.com/${handle}/status/${post.tweetId}`;
    lines.push(`- ${time} [↗](${url}) ${text}`);
  }
  fs.writeFileSync(mdPath, lines.join('\n') + '\n', 'utf-8');

  db.insert(rawArchives)
    .values({
      accountHandle: handle,
      archiveDate: date,
      filePath: ndjsonPath,
      postCount: posts.length,
      createdAt: nowISO(),
    })
    .run();

  logger.info({ handle, date, postCount: posts.length, ndjsonPath, mdPath }, 'Export complete');
}

main();
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: 运行导出（有数据的日期）**

先查一个有数据的日期：

```bash
npx tsx -e "
const { db } = require('./src/db');
const { xPosts } = require('./src/db/schema');
const { eq } = require('drizzle-orm');
const rows = db.select({ createdAt: xPosts.createdAt }).from(xPosts).where(eq(xPosts.authorHandle, 'aleabitoreddit')).limit(1).all();
console.log('sample createdAt:', rows[0]?.createdAt);
const date = rows[0]?.createdAt?.slice(0, 10);
console.log('use this date:', date);
"
```

用上面输出的日期运行导出（替换 `<DATE>`）：

```bash
pnpm x:export:daily --handle aleabitoreddit --date <DATE>
```

期望输出（有数据）：
```
{"level":30,"handle":"aleabitoreddit","date":"<DATE>","postCount":N,"ndjsonPath":"...","mdPath":"...","msg":"Export complete"}
```

- [ ] **Step 4: 验证文件内容**

```bash
ls exports/raw/aleabitoreddit/
ls exports/daily/aleabitoreddit/
head -1 exports/raw/aleabitoreddit/<DATE>.ndjson
head -5 exports/daily/aleabitoreddit/<DATE>.md
```

期望：
- ndjson 第一行是合法 JSON（原始推文）
- markdown 第一行是 `# @aleabitoreddit — <DATE> (N posts)`

- [ ] **Step 5: 验证 rawArchives 记录**

```bash
npx tsx -e "
const { db } = require('./src/db');
const { rawArchives } = require('./src/db/schema');
const { eq } = require('drizzle-orm');
const rows = db.select().from(rawArchives).where(eq(rawArchives.accountHandle, 'aleabitoreddit')).all();
console.log('raw_archives:', JSON.stringify(rows, null, 2));
"
```

期望：有一条记录，`postCount > 0`，`filePath` 指向 ndjson 文件

- [ ] **Step 6: 验证无数据日期（早退路径）**

```bash
pnpm x:export:daily --handle aleabitoreddit --date 1999-01-01
```

期望：
```
{"level":30,"handle":"aleabitoreddit","date":"1999-01-01","msg":"No posts for this date"}
```
不生成文件，不写 rawArchives

- [ ] **Step 7: Commit**

```bash
git add src/jobs/export-daily-raw.ts
git commit -m "feat: add export-daily-raw job (ndjson + markdown export by date)"
```

---

## Task 3: `src/jobs/status.ts`

**Files:**
- 创建: `src/jobs/status.ts`

- [ ] **Step 1: 创建文件**

```typescript
import dotenv from 'dotenv';
import { eq, count } from 'drizzle-orm';
import { resolveHandle } from '../utils/cli';
import { getWatchAccount } from '../services/account-service';
import { getCursor } from '../services/cursor-service';
import { getLatestRun } from '../services/run-log-service';
import { db } from '../db';
import { xPosts } from '../db/schema';

dotenv.config();

function main(): void {
  const handle = resolveHandle();

  const account = getWatchAccount(handle);
  const cursor = getCursor(handle);
  const latestRun = getLatestRun(handle);

  const countResult = db
    .select({ value: count() })
    .from(xPosts)
    .where(eq(xPosts.authorHandle, handle))
    .get();
  const postCount = countResult?.value ?? 0;

  const backfillStatus =
    cursor?.backfillCompleted === 1
      ? 'completed ✓'
      : cursor?.latestTweetId
        ? 'in progress'
        : 'not started';

  const lines = [
    `Account:   @${handle}`,
    `User ID:   ${account?.xUserId ?? 'not resolved'}`,
    `Posts:     ${postCount} total`,
    `Backfill:  ${cursor ? backfillStatus : 'not started'}`,
    `Latest:    ${cursor?.latestTweetId ?? 'n/a'}`,
    `Oldest:    ${cursor?.oldestTweetId ?? 'n/a'}`,
    '',
  ];

  if (latestRun) {
    lines.push(
      `Last run:  ${latestRun.runType} · ${latestRun.status} · ${latestRun.insertedPosts ?? 0} inserted · ${latestRun.startedAt}`,
    );
  } else {
    lines.push('Last run:  no runs yet');
  }

  console.log(lines.join('\n'));
}

main();
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

期望：exit 0，无错误

- [ ] **Step 3: 运行 status**

```bash
pnpm x:status --handle aleabitoreddit
```

期望输出（格式）：
```
Account:   @aleabitoreddit
User ID:   <id>
Posts:     <N> total
Backfill:  completed ✓
Latest:    <tweet_id>
Oldest:    <tweet_id>

Last run:  sync · success · <N> inserted · <timestamp>
```

- [ ] **Step 4: 验证未知账号（优雅降级）**

```bash
pnpm x:status --handle nonexistent_handle_xyz
```

期望：所有字段显示 `not resolved` / `0 total` / `not started` / `n/a`，不报错不 exit 1

- [ ] **Step 5: Commit**

```bash
git add src/jobs/status.ts
git commit -m "feat: add status job (account fetch status summary)"
```

---

## 完成标准

- `npx tsc --noEmit` 零错误
- `pnpm x:export:daily` 两种路径均正常：
  - 有推文 → ndjson + markdown 文件生成，`raw_archives` 有记录
  - 无推文 → log "No posts for this date"，不写文件
- `pnpm x:status` 正确输出账号状态，未知 handle 优雅显示 n/a
