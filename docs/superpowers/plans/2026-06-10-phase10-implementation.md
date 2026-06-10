# Phase 10: Data Quality & UX Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three targeted data-quality fixes: refresh metrics+text on duplicate tweet fetches, sync label from accounts.json into watch_accounts on resolve, and prettify errorMessage in x:status Last err display.

**Architecture:** All changes are isolated — no schema migrations, no new jobs, no new dependencies. `prettifyErrorMessage` lives in a new `src/utils/format.ts` (pure function, easily testable). Label reading is a new `getLabelFromConfig` function appended to existing `src/utils/cli.ts`. The duplicate-update path in `post-service.ts` expands from 1 field to 8. All other callers are untouched.

**Tech Stack:** TypeScript, tsx, better-sqlite3 + drizzle-orm, Vitest 2.1.9

---

## File Map

| Op | File | Change |
|---|---|---|
| Create | `src/utils/format.ts` | `prettifyErrorMessage` pure function |
| Create | `src/utils/__tests__/format.test.ts` | 7 test cases |
| Modify | `src/jobs/status.ts` | Apply `prettifyErrorMessage` to Last err line |
| Modify | `src/services/post-service.ts` | Duplicate path: add text + 6 metrics + rawJson |
| Modify | `src/utils/cli.ts` | Add `getLabelFromConfig(handle)` |
| Create | `src/utils/__tests__/get-label-from-config.test.ts` | 4 test cases |
| Modify | `src/services/account-service.ts` | Add optional `label` param to `upsertWatchAccount` |
| Modify | `src/jobs/resolve-account.ts` | Read label, pass to `upsertWatchAccount` |

---

### Task 1: prettifyErrorMessage — TDD

**Files:**
- Create: `src/utils/format.ts`
- Create: `src/utils/__tests__/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { prettifyErrorMessage } from '../format';

describe('prettifyErrorMessage', () => {
  it('passes through n/a unchanged', () => {
    expect(prettifyErrorMessage('n/a')).toBe('n/a');
  });

  it('capitalizes first letter and replaces underscores', () => {
    expect(prettifyErrorMessage('rate_limit_exceeded (429)')).toBe('Rate limit exceeded (429)');
  });

  it('handles colon-separated suffix', () => {
    expect(prettifyErrorMessage('not_found: handle=foo (404)')).toBe('Not found: handle=foo (404)');
  });

  it('handles auth prefix', () => {
    expect(prettifyErrorMessage('auth_failed: token invalid (401)')).toBe('Auth failed: token invalid (401)');
  });

  it('handles network prefix', () => {
    expect(prettifyErrorMessage('network_error: fetch failed ENOTFOUND')).toBe('Network error: fetch failed ENOTFOUND');
  });

  it('converts db_ prefix to DB', () => {
    expect(prettifyErrorMessage('db_error: UNIQUE constraint failed')).toBe('DB error: UNIQUE constraint failed');
  });

  it('converts api_ prefix to API', () => {
    expect(prettifyErrorMessage('api_error: 422')).toBe('API error: 422');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/utils/__tests__/format.test.ts
```

Expected: FAIL — `Cannot find module '../format'`

- [ ] **Step 3: Create `src/utils/format.ts`**

```typescript
export function prettifyErrorMessage(raw: string): string {
  if (raw === 'n/a') return raw;
  return raw
    .replace(/^db(?=_)/, 'DB')
    .replace(/^api(?=_)/, 'API')
    .replace(/_/g, ' ')
    .replace(/^./, c => c.toUpperCase());
}
```

- [ ] **Step 4: Run test to verify all 7 pass**

```bash
pnpm test src/utils/__tests__/format.test.ts
```

Expected: PASS — 7/7

- [ ] **Step 5: Commit**

```bash
git add src/utils/format.ts src/utils/__tests__/format.test.ts
git commit -m "feat(format): add prettifyErrorMessage utility with 7 test cases"
```

---

### Task 2: Apply prettifyErrorMessage to x:status Last err

**Files:**
- Modify: `src/jobs/status.ts` (line 59)

- [ ] **Step 1: Edit `src/jobs/status.ts`**

Add the import after the existing imports (before the `dotenv.config()` call, around line 10):

```typescript
import { prettifyErrorMessage } from '../utils/format';
```

Replace line 59:

Old:
```typescript
  lines.push(`Last err:  ${failedRun?.errorMessage ?? 'n/a'}`);
```

New:
```typescript
  lines.push(`Last err:  ${failedRun ? prettifyErrorMessage(failedRun.errorMessage ?? 'n/a') : 'n/a'}`);
```

- [ ] **Step 2: Run full test suite to confirm no regression**

```bash
pnpm test
```

Expected: all existing tests still PASS (no tests for status.ts, so just confirm nothing broke)

- [ ] **Step 3: Smoke-check manually (optional)**

If a local SQLite DB exists with a failed run, run:
```bash
pnpm x:status --handle <any_resolved_handle>
```
Verify Last err line shows capitalized text with spaces instead of underscores. If no failed run exists, `n/a` should appear unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/jobs/status.ts
git commit -m "feat(status): prettify Last err output using prettifyErrorMessage"
```

---

### Task 3: metrics + text refresh on duplicate post

**Files:**
- Modify: `src/services/post-service.ts` (lines 37–40)

- [ ] **Step 1: Update the duplicate path in `upsertPost`**

Replace lines 37–40:

Old:
```typescript
  db.update(xPosts)
    .set({ lastFetchedAt: params.lastFetchedAt })
    .where(eq(xPosts.tweetId, params.tweetId))
    .run();
```

New:
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

`firstFetchedAt`, `url`, and all other fields are intentionally absent from `.set()` — they keep their original values.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS (no unit test for post-service yet; existing tests unaffected)

- [ ] **Step 3: Commit**

```bash
git add src/services/post-service.ts
git commit -m "feat(post-service): refresh text + metrics + rawJson on duplicate tweet"
```

---

### Task 4: getLabelFromConfig — TDD

**Files:**
- Modify: `src/utils/cli.ts` (append new export)
- Create: `src/utils/__tests__/get-label-from-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/get-label-from-config.test.ts`:

```typescript
import fs from 'fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLabelFromConfig } from '../cli';

const makeConfig = (accounts: Array<{ handle: string; label?: string }>) =>
  JSON.stringify({ accounts });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getLabelFromConfig', () => {
  it('returns the label when present', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo', label: 'Foo Corp' }]) as any,
    );
    expect(getLabelFromConfig('foo')).toBe('Foo Corp');
  });

  it('returns undefined when label field is missing', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo' }]) as any,
    );
    expect(getLabelFromConfig('foo')).toBeUndefined();
  });

  it('returns undefined when account is not in config', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'other', label: 'Other' }]) as any,
    );
    expect(getLabelFromConfig('foo')).toBeUndefined();
  });

  it('normalizes @ prefix — config has @foo, input is foo', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: '@foo', label: 'Foo Corp' }]) as any,
    );
    expect(getLabelFromConfig('foo')).toBe('Foo Corp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/utils/__tests__/get-label-from-config.test.ts
```

Expected: FAIL — `getLabelFromConfig is not a function` (or similar export error)

- [ ] **Step 3: Append `getLabelFromConfig` to `src/utils/cli.ts`**

Add at the end of the file (after the closing brace of `checkAccountEnabled`):

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

`fs`, `path`, and `normalizeHandle` are already available in the file — no new imports needed.

- [ ] **Step 4: Run test to verify all 4 pass**

```bash
pnpm test src/utils/__tests__/get-label-from-config.test.ts
```

Expected: PASS — 4/4

- [ ] **Step 5: Run full suite**

```bash
pnpm test
```

Expected: all tests PASS (no regression in existing tests)

- [ ] **Step 6: Commit**

```bash
git add src/utils/cli.ts src/utils/__tests__/get-label-from-config.test.ts
git commit -m "feat(cli): add getLabelFromConfig with 4 test cases"
```

---

### Task 5: label sync — account-service + resolve-account wiring

**Files:**
- Modify: `src/services/account-service.ts` (lines 5–24)
- Modify: `src/jobs/resolve-account.ts` (lines 4, 53)

- [ ] **Step 1: Extend `upsertWatchAccount` signature in `account-service.ts`**

Replace lines 5–24 (the entire `upsertWatchAccount` function):

Old:
```typescript
export function upsertWatchAccount(
  handle: string,
  xUserId: string,
  now: string,
): void {
  db.insert(watchAccounts)
    .values({
      handle,
      xUserId,
      firstSeenAt: now,
      lastCheckedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: watchAccounts.handle,
      set: { xUserId, lastCheckedAt: now, updatedAt: now },
    })
    .run();
}
```

New:
```typescript
export function upsertWatchAccount(
  handle: string,
  xUserId: string,
  now: string,
  label?: string,
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

`label` is optional — all existing call sites that pass 3 args continue to work without modification.

- [ ] **Step 2: Wire label into `resolve-account.ts`**

Update line 4 to also import `getLabelFromConfig`:

Old:
```typescript
import { resolveHandle, checkAccountEnabled } from '../utils/cli';
```

New:
```typescript
import { resolveHandle, checkAccountEnabled, getLabelFromConfig } from '../utils/cli';
```

Update line 53 to read the label and pass it:

Old:
```typescript
    upsertWatchAccount(handle, user.id, now);
```

New:
```typescript
    const label = getLabelFromConfig(handle);
    upsertWatchAccount(handle, user.id, now, label);
```

The `getLabelFromConfig` call is already inside the `try` block — if `config/accounts.json` is missing, it throws `ENOENT`, which `classifyError` downstream catches and records as `config_error`.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/account-service.ts src/jobs/resolve-account.ts
git commit -m "feat(resolve): sync label from accounts.json into watch_accounts on x:resolve"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite one more time**

```bash
pnpm test
```

Expected: all 26+ tests PASS (7 new format tests + 4 new getLabelFromConfig tests = 37 total)

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Invoke finishing-a-development-branch skill**

Hand off to `superpowers:finishing-a-development-branch` to push and complete the branch.
