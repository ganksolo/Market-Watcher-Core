# Phase 8: P1 Closure Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four P1 stability issues: disabled-account hard-block, centralized error classification, failed-path run stats, and backfillCompleted write ordering.

**Architecture:** Two new utilities (`checkAccountEnabled` in `cli.ts`, `classify-error.ts`) are shared by three API-fetching jobs (resolve/backfill/sync). Variable hoisting and `backfillCompleted` ordering changes are confined to backfill/sync. Export gets a one-line log-level tweak.

**Tech Stack:** Node.js 22 + TypeScript + tsx, pnpm, SQLite via drizzle-orm (better-sqlite3), pino logger

---

## File Map

| Op | File | Change |
|---|---|---|
| Modify | `src/utils/cli.ts` | Add `checkAccountEnabled(handle)` |
| Create | `src/utils/classify-error.ts` | New `classifyError(err, context?)` |
| Modify | `src/clients/x-api-client.ts` | Retry exhaustion throws `ApiError(429)` |
| Modify | `src/jobs/resolve-account.ts` | `checkAccountEnabled` + `classifyError` in catch |
| Modify | `src/jobs/backfill-account.ts` | All four P1 fixes |
| Modify | `src/jobs/sync-account.ts` | `checkAccountEnabled` + `classifyError` + stats hoisting |
| Modify | `src/jobs/export-daily-raw.ts` | `logger.info` → `logger.warn` for no-data path |

---

### Task 1: checkAccountEnabled in cli.ts

**Files:**
- Modify: `src/utils/cli.ts`

`fs` and `path` are already imported. `normalizeHandle` is already defined. The function reads `config/accounts.json`, finds the entry for this handle, and calls `process.exit(1)` only if `enabled === false`. Handles not found in config pass through (allows external handles).

- [ ] **Step 1: Append `checkAccountEnabled` to `src/utils/cli.ts`**

Current file ends after `resolveHandle`. Add the following at the end of the file:

```typescript
export function checkAccountEnabled(handle: string): void {
  const accountsPath = path.resolve('config/accounts.json');
  const config: { accounts: Array<{ handle: string; enabled: boolean }> } =
    JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  const account = config.accounts.find(
    a => normalizeHandle(a.handle) === handle,
  );
  if (account && account.enabled === false) {
    console.error(`Account @${handle} is disabled in config/accounts.json — aborting`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/cli.ts
git commit -m "feat: add checkAccountEnabled to cli utils"
```

---

### Task 2: classify-error.ts (new file)

**Files:**
- Create: `src/utils/classify-error.ts`

Handles: `ApiError` (401 / 403 / 404 / 429 / 5xx / other), `TypeError` with network-related message, `ENOENT` from config-file reads, `SqliteError` from better-sqlite3, generic fallback. Returns `{ logMessage, errorMessage }` — callers log `logMessage` if non-empty, always store `errorMessage` in the run record.

- [ ] **Step 1: Create `src/utils/classify-error.ts`**

```typescript
import { ApiError } from '../clients/x-api-client';

export function classifyError(
  err: unknown,
  context?: { handle?: string },
): { logMessage: string; errorMessage: string } {
  if (err instanceof ApiError) {
    const { status, path } = err;
    if (status === 401) {
      return {
        logMessage: 'X_BEARER_TOKEN is invalid or expired',
        errorMessage: 'auth_failed: token invalid (401)',
      };
    }
    if (status === 403) {
      return {
        logMessage: 'Access forbidden — check X app permissions',
        errorMessage: 'auth_failed: forbidden (403)',
      };
    }
    if (status === 404) {
      const handle = context?.handle ?? 'unknown';
      return {
        logMessage: `Account not found or not accessible: @${handle}`,
        errorMessage: `not_found: handle=${handle} (404)`,
      };
    }
    if (status === 429) {
      return {
        logMessage: 'Rate limit exceeded after retries',
        errorMessage: 'rate_limit_exceeded (429)',
      };
    }
    if (status >= 500) {
      return {
        logMessage: `X API server error ${status} on ${path}`,
        errorMessage: `server_error: ${status}`,
      };
    }
    return {
      logMessage: `X API error ${status} on ${path}`,
      errorMessage: `api_error: ${status}`,
    };
  }

  if (
    err instanceof TypeError &&
    /fetch|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(err.message)
  ) {
    return {
      logMessage: 'Network error — check connectivity',
      errorMessage: `network_error: ${err.message}`,
    };
  }

  // ENOENT from config file reads (accounts.json, fetch-policy.json) in current job
  if (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    return {
      logMessage: `Config file not found: ${err.message}`,
      errorMessage: `config_error: ${err.message}`,
    };
  }

  // better-sqlite3 errors have name === 'SqliteError'
  if (err instanceof Error && err.name === 'SqliteError') {
    return {
      logMessage: `Database error: ${err.message}`,
      errorMessage: `db_error: ${err.message}`,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    logMessage: '',
    errorMessage: message,
  };
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/utils/classify-error.ts
git commit -m "feat: add classifyError utility"
```

---

### Task 3: x-api-client.ts — retry exhaustion throws ApiError(429)

**Files:**
- Modify: `src/clients/x-api-client.ts:60`

When all three retries are exhausted, the current code throws a plain `Error`. Changing to `ApiError(429)` lets `classifyError` handle it without special-casing.

- [ ] **Step 1: Replace the final throw in `src/clients/x-api-client.ts`**

Find (line 60):
```typescript
    throw new Error(`Max retries exceeded for ${path}`);
```

Replace with:
```typescript
    throw new ApiError(429, 'Max retries exceeded', path);
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/clients/x-api-client.ts
git commit -m "fix: throw ApiError(429) on max retries exhaustion"
```

---

### Task 4: resolve-account.ts — checkAccountEnabled + classifyError

**Files:**
- Modify: `src/jobs/resolve-account.ts`

Three changes:
1. Import `checkAccountEnabled` and `classifyError`
2. Call `checkAccountEnabled(handle)` right after `resolveHandle()`
3. Replace the manual `instanceof ApiError` catch block with `classifyError`

`resolve-account` has no pagination stats, so the catch block stays simple.

- [ ] **Step 1: Update imports**

Replace line 4:
```typescript
import { resolveHandle } from '../utils/cli';
```
With:
```typescript
import { resolveHandle, checkAccountEnabled } from '../utils/cli';
import { classifyError } from '../utils/classify-error';
```

Replace line 7 (remove `ApiError` — no longer used directly):
```typescript
import { createXApiClient, ApiError } from '../clients/x-api-client';
```
With:
```typescript
import { createXApiClient } from '../clients/x-api-client';
```

- [ ] **Step 2: Add `checkAccountEnabled` call after `resolveHandle()`**

Find (lines 21-23):
```typescript
  const handle = resolveHandle();

  let runId: number | undefined = undefined;
```
Replace with:
```typescript
  const handle = resolveHandle();
  checkAccountEnabled(handle);

  let runId: number | undefined = undefined;
```

- [ ] **Step 3: Replace the catch block (lines 77-95)**

Find:
```typescript
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (err instanceof ApiError) {
      if (err.status === 401) logger.error('X_BEARER_TOKEN is invalid or expired');
      else if (err.status === 404) logger.error({ handle }, 'Account not found or not accessible');
    }

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
      });
    }

    logger.error({ err }, 'resolve-account failed');
    process.exit(1);
  }
```
Replace with:
```typescript
  } catch (err) {
    const { logMessage, errorMessage } = classifyError(err, { handle });
    if (logMessage) logger.error({ handle }, logMessage);

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
      });
    }

    logger.error({ err }, 'resolve-account failed');
    process.exit(1);
  }
```

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/resolve-account.ts
git commit -m "feat: add checkAccountEnabled and classifyError to resolve-account"
```

---

### Task 5: backfill-account.ts — all four P1 fixes

**Files:**
- Modify: `src/jobs/backfill-account.ts`

This task applies all four P1 changes in one file:
- **P1-7**: `checkAccountEnabled` after `resolveHandle()`
- **P1-8**: `classifyError` in catch
- **P1-9**: Hoist counter variables + move policy loading inside try so catch gets partial stats
- **P1-10**: `isBackfillComplete` flag; write cursor BEFORE `finishRun(success)`; "skipping" message

Make the changes in order — each step refers to a distinct code section.

- [ ] **Step 1: Update imports**

Replace line 4:
```typescript
import { resolveHandle, getArg } from '../utils/cli';
```
With:
```typescript
import { resolveHandle, getArg, checkAccountEnabled } from '../utils/cli';
import { classifyError } from '../utils/classify-error';
```

Replace line 8 (remove `ApiError`):
```typescript
import { createXApiClient, ApiError } from '../clients/x-api-client';
```
With:
```typescript
import { createXApiClient } from '../clients/x-api-client';
```

- [ ] **Step 2: Replace the pre-try section (lines 23–58) — add checkAccountEnabled, remove policy loading, hoist variables**

Find (lines 23–58):
```typescript
  const handle = resolveHandle();
  const maxPagesArg = getArg('max-pages');

  const policyPath = path.resolve('config/fetch-policy.json');
  const policy: {
    default: {
      maxResultsPerPage: number;
      maxPagesPerRun: number;
      maxPostsPerRun: number;
      includeReplies: boolean;
      includeRetweets: boolean;
      includeQuotes: boolean;
      sleepMsBetweenRequests: number;
      estimatedPostReadCost: number;
      maxEstimatedCostPerRun: number;
    };
  } = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));

  const p = policy.default;
  const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;
  const maxPostsPerRun = p.maxPostsPerRun;

  const cursor = getCursor(handle);
  if (cursor?.backfillCompleted === 1) {
    logger.info({ handle }, 'Backfill already completed, nothing to do');
    return;
  }

  const account = getWatchAccount(handle);
  if (!account?.xUserId) {
    logger.error({ handle }, 'No x_user_id found — run pnpm x:resolve first');
    process.exit(1);
  }
  const xUserId = account.xUserId;

  let runId: number | undefined = undefined;
```
Replace with:
```typescript
  const handle = resolveHandle();
  checkAccountEnabled(handle);
  const maxPagesArg = getArg('max-pages');

  const cursor = getCursor(handle);
  if (cursor?.backfillCompleted === 1) {
    logger.info({ handle }, 'Backfill already completed — skipping');
    return;
  }

  const account = getWatchAccount(handle);
  if (!account?.xUserId) {
    logger.error({ handle }, 'No x_user_id found — run pnpm x:resolve first');
    process.exit(1);
  }
  const xUserId = account.xUserId;

  let runId: number | undefined = undefined;
  let p: {
    maxResultsPerPage: number;
    maxPagesPerRun: number;
    maxPostsPerRun: number;
    includeReplies: boolean;
    includeRetweets: boolean;
    includeQuotes: boolean;
    sleepMsBetweenRequests: number;
    estimatedPostReadCost: number;
    maxEstimatedCostPerRun: number;
  } | undefined = undefined;
  let pagesCount = 0;
  let insertedPosts = 0;
  let duplicatedPosts = 0;
  let totalEstimatedPostReads = 0;
```

- [ ] **Step 3: Replace the try-block opening (lines 60–78) — add policy loading, remove re-declarations of hoisted variables, add isBackfillComplete**

Find (lines 60–78):
```typescript
  try {
    runId = createRun('backfill', handle, nowISO());

    const client = createXApiClient();

    const excludeParts: string[] = [];
    if (!p.includeRetweets) excludeParts.push('retweets');
    if (!p.includeReplies) excludeParts.push('replies');

    let pagesCount = 0;
    let insertedPosts = 0;
    let duplicatedPosts = 0;
    let totalEstimatedPostReads = 0;
    let currentPaginationToken: string | undefined = cursor?.lastPaginationToken ?? undefined;
    let isFirstPage = !currentPaginationToken;

    logger.info({ handle, xUserId, maxPages }, 'Starting backfill');

    initCursor(handle, nowISO());
```
Replace with:
```typescript
  try {
    runId = createRun('backfill', handle, nowISO());

    const policyPath = path.resolve('config/fetch-policy.json');
    const policy: {
      default: {
        maxResultsPerPage: number;
        maxPagesPerRun: number;
        maxPostsPerRun: number;
        includeReplies: boolean;
        includeRetweets: boolean;
        includeQuotes: boolean;
        sleepMsBetweenRequests: number;
        estimatedPostReadCost: number;
        maxEstimatedCostPerRun: number;
      };
    } = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
    p = policy.default;
    const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;
    const maxPostsPerRun = p.maxPostsPerRun;

    const client = createXApiClient();

    const excludeParts: string[] = [];
    if (!p.includeRetweets) excludeParts.push('retweets');
    if (!p.includeReplies) excludeParts.push('replies');

    let currentPaginationToken: string | undefined = cursor?.lastPaginationToken ?? undefined;
    let isFirstPage = !currentPaginationToken;
    let isBackfillComplete = false;

    logger.info({ handle, xUserId, maxPages }, 'Starting backfill');

    initCursor(handle, nowISO());
```

- [ ] **Step 4: Update the cursorPatch block inside the while loop — remove `backfillCompleted`, add `isBackfillComplete` tracking**

Find (inside while loop):
```typescript
      const isLastPage = (tweets.length > 0 && !meta?.next_token) || meta?.result_count === 0;
      const cursorPatch: Parameters<typeof updateCursor>[1] = {
        lastPaginationToken: meta?.next_token ?? null,
        oldestTweetId: meta?.oldest_id ?? undefined,
        ...(isLastPage ? { backfillCompleted: 1 } : {}),
        updatedAt: pageNow,
      };
      if (isFirstPage && meta?.newest_id) {
        cursorPatch.latestTweetId = meta.newest_id;
        const newestCreatedAt = tweets[0]?.created_at;
        if (newestCreatedAt) cursorPatch.latestTweetCreatedAt = newestCreatedAt;
      }
      const oldestCreatedAt = tweets[tweets.length - 1]?.created_at;
      if (tweets.length > 0 && oldestCreatedAt) {
        cursorPatch.oldestTweetCreatedAt = oldestCreatedAt;
      }
      updateCursor(handle, cursorPatch);
      isFirstPage = false;
```
Replace with:
```typescript
      const isLastPage = (tweets.length > 0 && !meta?.next_token) || meta?.result_count === 0;
      const cursorPatch: Parameters<typeof updateCursor>[1] = {
        lastPaginationToken: meta?.next_token ?? null,
        oldestTweetId: meta?.oldest_id ?? undefined,
        updatedAt: pageNow,
      };
      if (isFirstPage && meta?.newest_id) {
        cursorPatch.latestTweetId = meta.newest_id;
        const newestCreatedAt = tweets[0]?.created_at;
        if (newestCreatedAt) cursorPatch.latestTweetCreatedAt = newestCreatedAt;
      }
      const oldestCreatedAt = tweets[tweets.length - 1]?.created_at;
      if (tweets.length > 0 && oldestCreatedAt) {
        cursorPatch.oldestTweetCreatedAt = oldestCreatedAt;
      }
      updateCursor(handle, cursorPatch);
      if (isLastPage) isBackfillComplete = true;
      isFirstPage = false;
```

- [ ] **Step 5: Write backfillCompleted cursor BEFORE finishRun(success)**

Find (after the while loop, the success finishRun):
```typescript
    const finalCostUsd = totalEstimatedPostReads * p.estimatedPostReadCost;
    finishRun(runId, {
      status: 'success',
```
Replace with:
```typescript
    if (isBackfillComplete) {
      updateCursor(handle, { backfillCompleted: 1, updatedAt: nowISO() });
    }

    const finalCostUsd = totalEstimatedPostReads * p.estimatedPostReadCost;
    finishRun(runId, {
      status: 'success',
```

- [ ] **Step 6: Replace the catch block**

Find:
```typescript
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (err instanceof ApiError) {
      if (err.status === 401) logger.error('X_BEARER_TOKEN is invalid or expired');
      else if (err.status === 404) logger.error({ handle }, 'Account not found or not accessible');
    }

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
      });
    }

    logger.error({ err }, 'backfill-account failed');
    process.exit(1);
  }
```
Replace with:
```typescript
  } catch (err) {
    const { logMessage, errorMessage } = classifyError(err, { handle });
    if (logMessage) logger.error({ handle }, logMessage);

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
        requestedPages: pagesCount,
        fetchedPosts: insertedPosts + duplicatedPosts,
        insertedPosts,
        duplicatedPosts,
        estimatedPostReads: totalEstimatedPostReads,
        estimatedCostUsd: p != null
          ? totalEstimatedPostReads * p.estimatedPostReadCost
          : undefined,
      });
    }

    logger.error({ err }, 'backfill-account failed');
    process.exit(1);
  }
```

- [ ] **Step 7: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/jobs/backfill-account.ts
git commit -m "feat: apply all P1 fixes to backfill-account (checkAccountEnabled, classifyError, stats hoisting, backfillCompleted ordering)"
```

---

### Task 6: sync-account.ts — checkAccountEnabled + classifyError + stats hoisting

**Files:**
- Modify: `src/jobs/sync-account.ts`

Same structural pattern as Task 5, minus `isBackfillComplete` (sync does not write `backfillCompleted`).

- [ ] **Step 1: Update imports**

Replace line 4:
```typescript
import { resolveHandle, getArg } from '../utils/cli';
```
With:
```typescript
import { resolveHandle, getArg, checkAccountEnabled } from '../utils/cli';
import { classifyError } from '../utils/classify-error';
```

Replace line 8 (remove `ApiError`):
```typescript
import { createXApiClient, ApiError } from '../clients/x-api-client';
```
With:
```typescript
import { createXApiClient } from '../clients/x-api-client';
```

- [ ] **Step 2: Replace the pre-try section (lines 23–58) — add checkAccountEnabled, remove policy loading, hoist variables**

Find (lines 23–58):
```typescript
  const handle = resolveHandle();
  const maxPagesArg = getArg('max-pages');

  const policyPath = path.resolve('config/fetch-policy.json');
  const policy: {
    default: {
      maxResultsPerPage: number;
      maxPagesPerRun: number;
      maxPostsPerRun: number;
      includeReplies: boolean;
      includeRetweets: boolean;
      includeQuotes: boolean;
      sleepMsBetweenRequests: number;
      estimatedPostReadCost: number;
      maxEstimatedCostPerRun: number;
    };
  } = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));

  const p = policy.default;
  const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;
  const maxPostsPerRun = p.maxPostsPerRun;

  const cursor = getCursor(handle);
  if (!cursor?.latestTweetId) {
    logger.error({ handle }, 'Backfill not completed — run pnpm x:backfill first');
    process.exit(1);
  }

  const account = getWatchAccount(handle);
  if (!account?.xUserId) {
    logger.error({ handle }, 'No x_user_id found — run pnpm x:resolve first');
    process.exit(1);
  }
  const xUserId = account.xUserId;

  let runId: number | undefined = undefined;
```
Replace with:
```typescript
  const handle = resolveHandle();
  checkAccountEnabled(handle);
  const maxPagesArg = getArg('max-pages');

  const cursor = getCursor(handle);
  if (!cursor?.latestTweetId) {
    logger.error({ handle }, 'Backfill not completed — run pnpm x:backfill first');
    process.exit(1);
  }

  const account = getWatchAccount(handle);
  if (!account?.xUserId) {
    logger.error({ handle }, 'No x_user_id found — run pnpm x:resolve first');
    process.exit(1);
  }
  const xUserId = account.xUserId;

  let runId: number | undefined = undefined;
  let p: {
    maxResultsPerPage: number;
    maxPagesPerRun: number;
    maxPostsPerRun: number;
    includeReplies: boolean;
    includeRetweets: boolean;
    includeQuotes: boolean;
    sleepMsBetweenRequests: number;
    estimatedPostReadCost: number;
    maxEstimatedCostPerRun: number;
  } | undefined = undefined;
  let pagesCount = 0;
  let insertedPosts = 0;
  let duplicatedPosts = 0;
  let totalEstimatedPostReads = 0;
```

- [ ] **Step 3: Replace the try-block opening (lines 60–84) — add policy loading, remove re-declarations of hoisted variables**

Find (lines 60–84):
```typescript
  try {
    runId = createRun('sync', handle, nowISO());

    const client = createXApiClient();

    const excludeParts: string[] = [];
    if (!p.includeRetweets) excludeParts.push('retweets');
    if (!p.includeReplies) excludeParts.push('replies');

    const baseParams: Record<string, string> = {
      'tweet.fields': TWEET_FIELDS,
      max_results: String(p.maxResultsPerPage),
      since_id: cursor.latestTweetId,
    };
    if (excludeParts.length) baseParams.exclude = excludeParts.join(',');

    let pagesCount = 0;
    let insertedPosts = 0;
    let duplicatedPosts = 0;
    let totalEstimatedPostReads = 0;
    let newestId: string | undefined = undefined;
    let currentPaginationToken: string | undefined;
    let firstPageTweets: XTweet[] = [];
```
Replace with:
```typescript
  try {
    runId = createRun('sync', handle, nowISO());

    const policyPath = path.resolve('config/fetch-policy.json');
    const policy: {
      default: {
        maxResultsPerPage: number;
        maxPagesPerRun: number;
        maxPostsPerRun: number;
        includeReplies: boolean;
        includeRetweets: boolean;
        includeQuotes: boolean;
        sleepMsBetweenRequests: number;
        estimatedPostReadCost: number;
        maxEstimatedCostPerRun: number;
      };
    } = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
    p = policy.default;
    const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;
    const maxPostsPerRun = p.maxPostsPerRun;

    const client = createXApiClient();

    const excludeParts: string[] = [];
    if (!p.includeRetweets) excludeParts.push('retweets');
    if (!p.includeReplies) excludeParts.push('replies');

    const baseParams: Record<string, string> = {
      'tweet.fields': TWEET_FIELDS,
      max_results: String(p.maxResultsPerPage),
      since_id: cursor.latestTweetId,
    };
    if (excludeParts.length) baseParams.exclude = excludeParts.join(',');

    let newestId: string | undefined = undefined;
    let currentPaginationToken: string | undefined;
    let firstPageTweets: XTweet[] = [];
```

- [ ] **Step 4: Replace the catch block**

Find:
```typescript
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (err instanceof ApiError) {
      if (err.status === 401) logger.error('X_BEARER_TOKEN is invalid or expired');
      else if (err.status === 404) logger.error({ handle }, 'Account not found or not accessible');
    }

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
      });
    }

    logger.error({ err }, 'sync-account failed');
    process.exit(1);
  }
```
Replace with:
```typescript
  } catch (err) {
    const { logMessage, errorMessage } = classifyError(err, { handle });
    if (logMessage) logger.error({ handle }, logMessage);

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
        requestedPages: pagesCount,
        fetchedPosts: insertedPosts + duplicatedPosts,
        insertedPosts,
        duplicatedPosts,
        estimatedPostReads: totalEstimatedPostReads,
        estimatedCostUsd: p != null
          ? totalEstimatedPostReads * p.estimatedPostReadCost
          : undefined,
      });
    }

    logger.error({ err }, 'sync-account failed');
    process.exit(1);
  }
```

- [ ] **Step 5: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/jobs/sync-account.ts
git commit -m "feat: apply P1 fixes to sync-account (checkAccountEnabled, classifyError, stats hoisting)"
```

---

### Task 7: export-daily-raw.ts — logger.warn for no-data path

**Files:**
- Modify: `src/jobs/export-daily-raw.ts:32`

One-line change — no-data dates should emit `warn` (not `info`) so they stand out in logs.

- [ ] **Step 1: Update the no-data log line**

Find (line 32):
```typescript
    logger.info({ handle, date }, 'No posts for this date');
```
Replace with:
```typescript
    logger.warn({ handle, date }, 'No posts for this date — export skipped');
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/jobs/export-daily-raw.ts
git commit -m "fix: use logger.warn for no-data export date"
```
