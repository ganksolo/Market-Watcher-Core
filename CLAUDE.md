# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

`market-watcher-core` is a local CLI data-engineering tool: given a list of X/Twitter handles, it fetches their posts via the X API v2, stores raw data in SQLite, and exports ndjson/markdown. No LLM analysis, no UI, no deployment — raw data collection only.

## Commands

```bash
pnpm install                                          # install deps
pnpm db:migrate                                       # create/update SQLite tables (run once before anything else)
pnpm db:generate                                      # regenerate drizzle migration files from schema.ts

pnpm x:resolve --handle <handle>                      # resolve handle → x_user_id, save to DB
pnpm x:backfill --handle <handle> --max-pages <n>     # historical backfill
pnpm x:sync --handle <handle>                         # incremental sync (new posts only)
pnpm x:export:daily --handle <handle> --date YYYY-MM-DD  # export ndjson + markdown
pnpm x:status --handle <handle>                       # print account fetch status
```

There is no build step, lint, or test suite — scripts run directly via `tsx`.

## Architecture

### Two parallel DB layers

The project uses **raw SQL for migrations** (`src/db/migrate.ts`) and **Drizzle ORM for queries** (`src/db/schema.ts` + `src/db/index.ts`). Do not add Drizzle migration files — schema changes go into the `sqlite.exec(...)` block in `migrate.ts`.

### Data flow

```
config/accounts.json          → which handles to track
config/fetch-policy.json      → rate, page, cost limits
X API v2 (Bearer Token)       → raw tweet data
src/db/ (SQLite)              → permanent store
exports/raw/{handle}/         → ndjson per day
exports/daily/{handle}/       → markdown per day
logs/fetch-runs/              → run logs
```

`data/`, `logs/`, `exports/` are gitignored — they are runtime output.

### Source layout

| Path | Role |
|---|---|
| `src/db/schema.ts` | Drizzle table definitions (source of truth for shape) |
| `src/db/migrate.ts` | Standalone migration runner (raw SQL `CREATE TABLE IF NOT EXISTS`) |
| `src/db/index.ts` | Drizzle `db` singleton (not yet created) |
| `src/clients/x-api-client.ts` | X API v2 HTTP client with 429 retry (not yet created) |
| `src/services/` | One file per concern: account, post, cursor, run-log, export (not yet created) |
| `src/jobs/` | One file per CLI command — entry points called by `pnpm` scripts (not yet created) |
| `src/utils/` | `logger` (pino), `cli` (arg parsing), `cost`, `sleep`, `date` |

### Phases — what exists vs. what is needed

**Phase 1 (done):** schema, migrate, utils, config files.

**Phases 2–7 (not implemented):** `src/clients/`, `src/services/`, `src/jobs/` directories exist but are empty.

### Key constraints to preserve

- **Cost protection**: every job that calls the API must check estimated cost against `maxEstimatedCostPerRun` before starting, and abort with `status = stopped_by_cost_limit` if exceeded.
- **Dedup**: `tweet_id` is `UNIQUE`; duplicate inserts increment `duplicated_posts` counter, never throw.
- **Cursor persistence**: after each page during backfill, write `last_pagination_token` + `oldest_tweet_id` to `fetch_cursors` so a crash can be resumed.
- **No token in logs**: `X_BEARER_TOKEN` must never appear in pino output.
- **Tweet filtering**: `exclude=retweets` when `includeRetweets: false`; `exclude=replies` when `includeReplies: false`. Quotes cannot be excluded via the API — post-filter in code if needed.

### X API v2 endpoints used

- `GET /2/users/by/username/:username` — resolve handle → user object
- `GET /2/users/:id/tweets` — paginated timeline; supports `since_id`, `until_id`, `pagination_token`, `exclude`, `max_results`

## 当前进度

Phase 1、2、3 已完成。下一步：Phase 4 — `post-service` + `backfill-account` job。

**Phase 2 产物：**
- `src/db/index.ts` — Drizzle `db` 单例（无 dotenv，由 job 入口负责加载 env）
- `src/clients/x-api-types.ts` — `XUser`, `XTweet`, `XApiResponse<T>`, `XApiListResponse<T>`, `XApiError`
- `src/clients/x-api-client.ts` — `XApiClient.get<T>()`, `ApiError`, `createXApiClient()`

**Phase 3 产物：**
- `src/services/account-service.ts` — `upsertWatchAccount`, `getWatchAccount`, `upsertXUser`
- `src/services/cursor-service.ts` — `initCursor`, `getCursor`（Phase 4 需补充 `updateCursor`）
- `src/services/run-log-service.ts` — `createRun`, `finishRun`, `getLatestRun`
- `src/jobs/resolve-account.ts` — `pnpm x:resolve --handle <handle>`

### Environment

`.env` (gitignored) must define `X_BEARER_TOKEN`. `DATABASE_URL` defaults to `file:./data/market-watcher.sqlite`.
