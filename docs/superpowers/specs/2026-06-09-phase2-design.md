# Phase 2 Design: DB Singleton + X API Client

**Date:** 2026-06-09  
**Scope:** `src/db/index.ts`, `src/clients/x-api-types.ts`, `src/clients/x-api-client.ts`

---

## 1. `src/db/index.ts` — Drizzle 单例

模块级单例，进程内共享一个 SQLite 连接。

```
DATABASE_URL env → resolve 路径 → 确保目录存在
better-sqlite3 连接
  pragma journal_mode = WAL
  pragma foreign_keys = ON
drizzle(sqlite, { schema }) → export const db
```

- 只导出 `db`（Drizzle 实例），不导出底层 `sqlite` 连接
- services 层通过 `import { db } from '../db'` 使用

---

## 2. `src/clients/x-api-types.ts` — X API 响应类型

覆盖 Phase 2 所需的两个 endpoint。

### 核心类型

```typescript
interface XUser {
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

interface XTweet {
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
```

### 响应包装

```typescript
interface XApiResponse<T> {
  data?: T;
  errors?: XApiError[];
}

interface XApiListResponse<T> {
  data?: T[];
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    next_token?: string;
    result_count?: number;
  };
  errors?: XApiError[];
}

interface XApiError {
  title: string;
  detail?: string;
  type?: string;
}
```

---

## 3. `src/clients/x-api-client.ts` — 薄 HTTP 层

### 结构

```
ApiError extends Error
  status: number
  body: string
  path: string

class XApiClient
  private token: string
  get<T>(path: string, params?: Record<string, string>): Promise<T>

function createXApiClient(): XApiClient
```

### `get()` 重试逻辑

```
构建 URL：new URL(BASE_URL + path)
params → url.searchParams.set(key, value)

loop attempt 1..3:
  fetch(url, { Authorization: Bearer {token} })
  429 → 读 x-rate-limit-reset header
        sleep(reset * 1000 - Date.now() + 1000，fallback 60_000ms)
        continue
  !ok  → throw ApiError(status, body, path)
  ok   → return response.json()

超出重试 → throw Error('Max retries exceeded for {path}')
```

### 关键约束

- 日志只打 `path`、`attempt`、`waitMs`，不打 `token`
- 使用 `new URL()` 构建请求，不手拼 query string
- 原生 `fetch`（Node 22），无额外 HTTP 依赖
- `createXApiClient()` 读取 `X_BEARER_TOKEN`，缺失则 `logger.error` + `process.exit(1)`

### 错误处理策略

调用方（services/jobs）捕获 `ApiError`，通过 `error.status` 区分错误类型：
- `401` → token 无效
- `403` → 权限不足
- `404` → 账号不存在
- `5xx` → X API 服务异常

---

## 4. 附：`.env` 文件

从 `.env.example` 复制 `.env`，供用户填入 `X_BEARER_TOKEN`。文件已在 `.gitignore`。

---

## 决策记录

| 问题 | 决策 | 理由 |
|---|---|---|
| API 错误处理 | throw `ApiError` 类 | 携带 status，job 层可按错误类型做不同处理 |
| DB 生命周期 | 模块级单例 | 单进程 CLI，一个连接够用，最简单 |
| 429 重试 | 读 header 优先，fallback 60s | 精确 + 健壮 |
| 类型位置 | 独立 `x-api-types.ts` | services 层直接 import 类型，避免循环依赖 |
| Client 粒度 | 薄 HTTP 层（只有 `get()`） | 字段配置权交给 services，client 职责单一 |
