# Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Drizzle ORM DB 单例、X API v2 响应类型定义、以及带 429 重试和统一错误处理的薄 HTTP 客户端。

**Architecture:** `src/db/index.ts` 导出模块级 Drizzle 单例供所有 services 使用；`src/clients/x-api-types.ts` 定义 X API v2 响应结构；`src/clients/x-api-client.ts` 封装 fetch + 429 retry + ApiError，不含任何业务逻辑。

**Tech Stack:** Node.js 22 原生 fetch、better-sqlite3、drizzle-orm@0.31.4、TypeScript、tsx

---

## 文件清单

| 操作 | 路径 | 职责 |
|---|---|---|
| 创建 | `src/db/index.ts` | Drizzle `db` 单例，进程内唯一 SQLite 连接 |
| 创建 | `src/clients/x-api-types.ts` | X API v2 响应 interface 定义 |
| 创建 | `src/clients/x-api-client.ts` | 薄 HTTP 层：`XApiClient.get()`、`ApiError`、`createXApiClient()` |

---

## Task 1: DB 单例 (`src/db/index.ts`)

**Files:**
- 创建: `src/db/index.ts`

- [ ] **Step 1: 创建 `src/db/index.ts`**

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import * as schema from './schema';

dotenv.config();

const dbUrl = process.env.DATABASE_URL ?? 'file:./data/market-watcher.sqlite';
const dbPath = dbUrl.replace(/^file:/, '');
const resolved = path.resolve(dbPath);

const dataDir = path.dirname(resolved);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(resolved);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
```

- [ ] **Step 2: 确认数据库已初始化**

先运行 migrate（如果还没跑过）：

```bash
pnpm db:migrate
```

期望输出：
```
Migration complete: all 6 tables created successfully
Database: /path/to/data/market-watcher.sqlite
```

- [ ] **Step 3: TypeScript 类型检查**

```bash
npx tsc --noEmit
```

期望输出：无错误（exit 0）

- [ ] **Step 4: Smoke test — DB 连接可用**

```bash
npx tsx -e "
import { db } from './src/db/index.js';
import { watchAccounts } from './src/db/schema.js';
const rows = db.select().from(watchAccounts).all();
console.log('DB ok, watch_accounts rows:', rows.length);
"
```

期望输出：
```
DB ok, watch_accounts rows: 0
```

- [ ] **Step 5: Commit**

```bash
git add src/db/index.ts
git commit -m "feat: add Drizzle ORM db singleton"
```

---

## Task 2: X API 响应类型 (`src/clients/x-api-types.ts`)

**Files:**
- 创建: `src/clients/x-api-types.ts`

- [ ] **Step 1: 创建 `src/clients/x-api-types.ts`**

```typescript
export interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  location?: string;
  verified?: boolean;
  verified_type?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
  created_at?: string;
}

export interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  lang?: string;
  public_metrics?: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
    quote_count: number;
    bookmark_count: number;
    impression_count: number;
  };
  referenced_tweets?: Array<{
    type: 'retweeted' | 'quoted' | 'replied_to';
    id: string;
  }>;
}

export interface XApiResponse<T> {
  data?: T;
  errors?: XApiError[];
}

export interface XApiListResponse<T> {
  data?: T[];
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    next_token?: string;
    result_count?: number;
  };
  errors?: XApiError[];
}

export interface XApiError {
  title: string;
  detail?: string;
  type?: string;
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
npx tsc --noEmit
```

期望输出：无错误（exit 0）

- [ ] **Step 3: Commit**

```bash
git add src/clients/x-api-types.ts
git commit -m "feat: add X API v2 response type definitions"
```

---

## Task 3: X API HTTP 客户端 (`src/clients/x-api-client.ts`)

**Files:**
- 创建: `src/clients/x-api-client.ts`

- [ ] **Step 1: 创建 `src/clients/x-api-client.ts`**

```typescript
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import { sleep } from '../utils/sleep';

dotenv.config();

const BASE_URL = 'https://api.twitter.com/2';
const MAX_RETRIES = 3;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`X API error ${status} on ${path}: ${body}`);
    this.name = 'ApiError';
  }
}

export class XApiClient {
  private readonly token: string;

  constructor(bearerToken: string) {
    this.token = bearerToken;
  }

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== '') url.searchParams.set(key, value);
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': 'market-watcher-core/0.1',
        },
      });

      if (response.status === 429) {
        const resetHeader = response.headers.get('x-rate-limit-reset');
        const waitMs = resetHeader
          ? Math.max(0, parseInt(resetHeader, 10) * 1000 - Date.now()) + 1000
          : 60_000;
        logger.warn({ attempt, waitMs, path }, 'Rate limited, retrying after sleep');
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new ApiError(response.status, body, path);
      }

      return response.json() as Promise<T>;
    }

    throw new Error(`Max retries exceeded for ${path}`);
  }
}

export function createXApiClient(): XApiClient {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    logger.error('X_BEARER_TOKEN is not set in environment');
    process.exit(1);
  }
  return new XApiClient(token);
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
npx tsc --noEmit
```

期望输出：无错误（exit 0）

- [ ] **Step 3: Smoke test — ApiError 结构正确，client 可实例化**

```bash
npx tsx -e "
import { ApiError, XApiClient } from './src/clients/x-api-client.js';

// 验证 ApiError
const err = new ApiError(404, 'Not Found', '/users/by/username/test');
console.assert(err.status === 404, 'status should be 404');
console.assert(err.name === 'ApiError', 'name should be ApiError');
console.assert(err instanceof Error, 'should be Error');
console.log('ApiError ok');

// 验证 XApiClient 可实例化（不发请求）
const client = new XApiClient('fake-token-for-test');
console.assert(typeof client.get === 'function', 'get should be a function');
console.log('XApiClient ok');
"
```

期望输出：
```
ApiError ok
XApiClient ok
```

- [ ] **Step 4: Smoke test — createXApiClient 读取 .env token**

```bash
npx tsx -e "
import { createXApiClient } from './src/clients/x-api-client.js';
const client = createXApiClient();
console.log('createXApiClient ok, client ready');
"
```

期望输出（token 已在 .env）：
```
createXApiClient ok, client ready
```

若输出 `X_BEARER_TOKEN is not set`：检查 `.env` 文件是否存在且 token 已填写。

- [ ] **Step 5: Commit**

```bash
git add src/clients/x-api-client.ts
git commit -m "feat: add X API v2 HTTP client with 429 retry and ApiError"
```

---

## 完成标准

Phase 2 全部完成后：
- `npx tsc --noEmit` 零错误
- `db` 单例可正常查询 SQLite
- `XApiClient` 可实例化，`ApiError` 结构正确
- `createXApiClient()` 从 `.env` 读取 token
- 3 个 commit 对应 3 个文件
