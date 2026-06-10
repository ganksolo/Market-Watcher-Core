# Phase 10 Design: Data Quality & UX Polish

## Goal

三项优化：
1. metrics + text 刷新 — duplicate tweet 重复抓取时同步最新内容
2. label 同步到 DB — `x:resolve` 时将 `accounts.json` 的 label 写入 `watch_accounts`
3. Last err 轻度格式化 — `x:status` 输出时将 errorMessage 转为可读形式，DB 存储不变

---

## Scope

- 不改 schema / migrate.ts
- 不新增 job
- `prettifyErrorMessage` 只在 `status.ts` 展示层使用，不改 `fetch_runs.error_message` 存储格式
- label 以 `accounts.json` 为权威来源，每次 `x:resolve` 覆盖写入（`null` 如果 config 无此字段）
- text 更新不保留历史版本（当前阶段无 diff/history 需求）

---

## Architecture

修改范围：
- `src/services/post-service.ts` — duplicate 路径补充 text + metrics + rawJson 更新
- `src/services/account-service.ts` — `upsertWatchAccount` 增加 `label` 参数
- `src/utils/cli.ts` — 新增 `getLabelFromConfig(handle)`
- `src/jobs/resolve-account.ts` — 读取 label 并传入 `upsertWatchAccount`
- `src/utils/format.ts` — 新增（提取 `prettifyErrorMessage` 纯函数）
- `src/jobs/status.ts` — 导入并应用 `prettifyErrorMessage` 于 Last err 输出
- `src/utils/__tests__/format.test.ts` — 新增（7 个转换用例）

---

## File Map

| 操作 | 文件 | 改动内容 |
|---|---|---|
| 修改 | `src/services/post-service.ts` | duplicate 路径写入 text + 6 metrics + rawJson |
| 修改 | `src/services/account-service.ts` | `upsertWatchAccount` 增加可选 `label` 参数 |
| 修改 | `src/utils/cli.ts` | 新增 `getLabelFromConfig(handle)` |
| 修改 | `src/jobs/resolve-account.ts` | 读 label，传给 `upsertWatchAccount` |
| 新增 | `src/utils/format.ts` | `prettifyErrorMessage(raw)` 纯函数 |
| 修改 | `src/jobs/status.ts` | 导入 `prettifyErrorMessage`，Last err 行应用 |
| 新增 | `src/utils/__tests__/format.test.ts` | 7 个转换用例（含 DB/API 缩写 + n/a 直通） |

---

## Section 1: metrics + text 刷新

### 设计

`upsertPost`（`src/services/post-service.ts`）的 duplicate 路径改为：

```typescript
db.update(xPosts)
  .set({
    text: params.text,
    likeCount: params.likeCount,
    replyCount: params.replyCount,
    repostCount: params.repostCount,
    quoteCount: params.quoteCount,
    bookmarkCount: params.bookmarkCount,
    impressionCount: params.impressionCount,
    rawJson: params.rawJson,
    lastFetchedAt: params.lastFetchedAt,
  })
  .where(eq(xPosts.tweetId, params.tweetId))
  .run();
```

`firstFetchedAt` 不在 `.set()` 中，保持首次抓取值不变。函数签名和返回值（`{ inserted: boolean }`）不变。

**`url` 不更新**：`url` 由 `tweet_id` + `handle` 静态推导（`https://x.com/{handle}/status/{tweet_id}`），tweet_id 稳定时 url 不会改变，无需纳入 duplicate 更新集。

### 完成标准

- 同一 tweet 第二次抓取后，`x_posts` 中 `like_count`、`text`、`raw_json` 均已更新
- `first_fetched_at` 保持首次值不变
- `duplicated_posts` 计数仍正确递增

---

## Section 2: label 同步（仅 x:resolve）

### 设计

**`src/utils/cli.ts` — 新增函数：**

```typescript
export function getLabelFromConfig(handle: string): string | undefined {
  const accountsPath = path.resolve('config/accounts.json');
  const config: { accounts: Array<{ handle: string; label?: string }> } =
    JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  const account = config.accounts.find(
    a => normalizeHandle(a.handle) === handle,
  );
  return account?.label;
}
```

`fs` 和 `path` 已在 `cli.ts` 中导入，无新依赖。账号不在配置中或无 `label` 字段时返回 `undefined`。

**`src/services/account-service.ts` — 扩展现有签名 `upsertWatchAccount(handle, xUserId, now)` 增加第四个可选参数：**

```typescript
export function upsertWatchAccount(
  handle: string,
  xUserId: string,
  now: string,
  label?: string,          // 新增，其余参数不变
): void {
  db.insert(watchAccounts)
    .values({
      handle,
      xUserId,
      label: label ?? null,
      firstSeenAt: now,
      lastCheckedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: watchAccounts.handle,
      set: { xUserId, label: label ?? null, lastCheckedAt: now, updatedAt: now },
    })
    .run();
}
```

`label` 为 `undefined` 时写 `null`，以 `accounts.json` 为权威来源覆盖写入。现有三个调用点（`resolve-account.ts`）不传第四参数则行为不变。

**`src/jobs/resolve-account.ts` — 调用处修改：**

```typescript
const label = getLabelFromConfig(handle);
upsertWatchAccount(handle, user.id, now, label);
```

`getLabelFromConfig` 调用放在 try 块内 `upsertWatchAccount` 之前。accounts.json 不存在时抛出 ENOENT，被外层 `classifyError` 捕获归为 `config_error`，行为与现有逻辑一致。

### 完成标准

- `x:resolve` 后 `watch_accounts.label` 与 `accounts.json` 中的 `label` 字段一致
- accounts.json 中无 `label` 字段时，DB 写入 `null`，不报错
- backfill / sync 不感知 label，行为不变

---

## Section 3: Last err 轻度格式化

### 设计

**`src/utils/format.ts` — 新增文件：**

```typescript
export function prettifyErrorMessage(raw: string): string {
  return raw
    .replace(/^db(?=_)/, 'DB')
    .replace(/^api(?=_)/, 'API')
    .replace(/_/g, ' ')
    .replace(/^./, c => c.toUpperCase());
}
```

**`src/jobs/status.ts` — 导入并应用：**

```typescript
import { prettifyErrorMessage } from '../utils/format';

// Last err 输出行：
lines.push(`Last err:  ${failedRun ? prettifyErrorMessage(failedRun.errorMessage ?? 'n/a') : 'n/a'}`);
```

转换示例：

| DB 存储（不变） | status 输出 |
|---|---|
| `rate_limit_exceeded (429)` | `Rate limit exceeded (429)` |
| `not_found: handle=foo (404)` | `Not found: handle=foo (404)` |
| `auth_failed: token invalid (401)` | `Auth failed: token invalid (401)` |
| `network_error: fetch failed ENOTFOUND...` | `Network error: fetch failed ENOTFOUND...` |
| `db_error: UNIQUE constraint failed` | `DB error: UNIQUE constraint failed` |
| `api_error: 422` | `API error: 422` |
| `n/a` | `n/a`（直通，无下划线） |

DB 层 `fetch_runs.error_message` 存储格式不变。

**测试文件 `src/utils/__tests__/format.test.ts`** 覆盖上述七个用例（含 `DB`/`API` 首字母缩写和 `n/a` 直通）。

### 完成标准

- `x:status` 输出的 `Last err` 行首字母大写、下划线替换为空格
- `fetch_runs.error_message` 原始值不变
- `prettifyErrorMessage` 在 `src/utils/format.ts` 导出，七个用例均有单测（含 `DB`/`API` 缩写、`n/a` 直通），`pnpm test` 通过
