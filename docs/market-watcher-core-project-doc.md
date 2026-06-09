# Market Watcher Core 项目文档

> Version: v0.1  
> Purpose: 用于 Vibe Coding 的项目输入文档  
> Scope: 只负责 X/Twitter 原始数据抓取、存储、去重、导出，不做 LLM 分析与 Agent 画像  

---

## 1. 项目定位

### 1.1 项目名称

```text
market-watcher-core
```

### 1.2 项目目标

Market Watcher Core 是 Market Watcher Agent 的前置数据工程项目。

它的目标不是分析市场，也不是总结观点，而是稳定地完成以下事情：

```text
指定 X 博主 handle
↓
通过 X API 抓取公开 posts
↓
保存原始数据 raw_json
↓
记录发布时间、推文 ID、正文、互动指标、引用关系
↓
支持历史回溯 backfill
↓
支持每日增量 sync
↓
导出 raw markdown / ndjson
↓
为后续 Market Watcher Agent 提供可靠数据源
```

### 1.3 第一阶段只做什么

第一阶段只做 Core，不做 Agent。

需要完成：

```text
1. X API 抓取
2. SQLite 存储
3. tweet_id 去重
4. 历史 backfill
5. 每日 sync
6. 原始 JSON 保存
7. 成本估算与保护
8. 运行日志
9. raw markdown 导出
10. raw ndjson 导出
```

### 1.4 第一阶段不做什么

以下内容全部放到第二阶段：

```text
1. Market Thinking Profile
2. 观点分类
3. 预测账本
4. 每日市场总结
5. LLM 分析
6. 多博主复杂看板
7. UI 页面
8. Telegram / Email 推送
9. 自动交易信号
10. Hermes Agent 集成
```

---

## 2. 产品边界

### 2.1 正确定位

这个项目应该被定义为：

```text
基于公开 X posts 的个人研究用观点跟踪数据底座
```

而不是：

```text
复制某个博主风格的 Agent
冒充某个博主的 Agent
自动生成交易建议的 Agent
```

### 2.2 第一阶段验收目标

Market Watcher Core 第一阶段完成的标准：

```text
我可以稳定拿到某个博主的原始 posts，连续跑几天不会重复、不会乱花 credits、不会丢数据。
```

---

## 3. 推荐技术栈

### 3.1 技术选型

```text
Node.js
TypeScript
SQLite
Drizzle ORM 或 Prisma
pnpm
pino 日志
dotenv
tsx
```

### 3.2 为什么不一开始用复杂架构

第一阶段只是本地数据采集工具，不需要：

```text
NestJS
PostgreSQL
Redis
队列系统
前端 UI
Docker 部署
云函数
```

先本地跑通即可。

### 3.3 后续可迁移方向

如果后续数据量扩大，可以迁移到：

```text
SQLite → PostgreSQL
本地 cron → GitHub Actions / VPS cron
本地 markdown → RAG 文档库
单博主 → 多博主
Core → Market Watcher Agent
```

---

## 4. 项目目录结构

建议目录结构：

```text
market-watcher-core/
  README.md
  package.json
  tsconfig.json
  .env.example
  .gitignore

  config/
    accounts.json
    fetch-policy.json

  src/
    index.ts

    clients/
      x-api-client.ts

    jobs/
      resolve-account.ts
      backfill-account.ts
      sync-account.ts
      export-daily-raw.ts
      status.ts

    services/
      account-service.ts
      post-service.ts
      cursor-service.ts
      cost-service.ts
      run-log-service.ts
      export-service.ts

    db/
      schema.ts
      migrate.ts
      migrations/

    utils/
      logger.ts
      sleep.ts
      date.ts
      cost.ts
      cli.ts

  data/
    market-watcher.sqlite

  exports/
    raw/
    daily/

  logs/
    fetch-runs/
```

---

## 5. 配置设计

### 5.1 `.env.example`

```bash
X_BEARER_TOKEN=
DATABASE_URL=file:./data/market-watcher.sqlite

DEFAULT_MAX_PAGES_PER_RUN=10
DEFAULT_MAX_COST_PER_RUN=5
LOG_LEVEL=info
```

真实 `.env` 不要提交到 Git。

---

### 5.2 `config/accounts.json`

第一版只配置一个博主即可。

```json
{
  "accounts": [
    {
      "handle": "target_blogger",
      "label": "macro_market_blogger",
      "enabled": true,
      "note": "经济市场分析博主"
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| handle | X 用户名，不带 @ |
| label | 本地标签 |
| enabled | 是否启用抓取 |
| note | 备注 |

---

### 5.3 `config/fetch-policy.json`

```json
{
  "default": {
    "maxResultsPerPage": 100,
    "maxPagesPerRun": 10,
    "maxPostsPerRun": 1000,
    "includeReplies": true,
    "includeRetweets": false,
    "includeQuotes": true,
    "stopWhenNoNextToken": true,
    "sleepMsBetweenRequests": 1200,
    "estimatedPostReadCost": 0.005,
    "estimatedUserReadCost": 0.01,
    "maxEstimatedCostPerRun": 5
  }
}
```

建议默认策略：

```text
includeReplies: true
includeRetweets: false
includeQuotes: true
```

原因：

```text
回复：通常包含该博主的观点，建议保留。
转推：不一定是该博主自己的观点，第一版先排除。
引用：通常包含该博主自己的评论，建议保留。
```

---

## 6. 数据库设计

第一版至少需要 5 张核心表：

```text
watch_accounts
x_users
x_posts
fetch_cursors
fetch_runs
```

可选表：

```text
raw_archives
```

---

### 6.1 `watch_accounts`

用途：记录要跟踪的 X 账号。

```sql
CREATE TABLE watch_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL UNIQUE,
  x_user_id TEXT,
  label TEXT,
  enabled INTEGER DEFAULT 1,
  note TEXT,
  first_seen_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

字段说明：

| 字段 | 说明 |
|---|---|
| handle | X 用户名 |
| x_user_id | X 内部 user id |
| label | 本地标签 |
| enabled | 是否启用 |
| first_seen_at | 第一次解析时间 |
| last_checked_at | 最近检查时间 |

---

### 6.2 `x_users`

用途：保存 X 用户资料快照。

```sql
CREATE TABLE x_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x_user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  name TEXT,
  description TEXT,
  location TEXT,
  verified INTEGER,
  verified_type TEXT,
  followers_count INTEGER,
  following_count INTEGER,
  tweet_count INTEGER,
  listed_count INTEGER,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
```

说明：

```text
用户资料不需要每次同步都抓。
第一次 resolve 时抓一次即可。
后续可以每周或每月刷新一次。
```

---

### 6.3 `x_posts`

用途：保存最核心的原始 posts 数据。

```sql
CREATE TABLE x_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  tweet_id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL,
  author_handle TEXT NOT NULL,

  text TEXT NOT NULL,
  lang TEXT,
  created_at TEXT NOT NULL,

  conversation_id TEXT,
  in_reply_to_user_id TEXT,

  referenced_type TEXT,
  referenced_tweet_id TEXT,

  like_count INTEGER,
  reply_count INTEGER,
  repost_count INTEGER,
  quote_count INTEGER,
  bookmark_count INTEGER,
  impression_count INTEGER,

  url TEXT,

  raw_json TEXT NOT NULL,

  first_fetched_at TEXT NOT NULL,
  last_fetched_at TEXT NOT NULL
);
```

关键要求：

```text
tweet_id 必须唯一
raw_json 必须保存
created_at 必须保存
text 必须保存
重复运行不能重复插入
```

---

### 6.4 `fetch_cursors`

用途：记录抓取断点。

```sql
CREATE TABLE fetch_cursors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_handle TEXT NOT NULL UNIQUE,

  latest_tweet_id TEXT,
  latest_tweet_created_at TEXT,

  oldest_tweet_id TEXT,
  oldest_tweet_created_at TEXT,

  last_pagination_token TEXT,
  backfill_completed INTEGER DEFAULT 0,

  updated_at TEXT NOT NULL
);
```

字段说明：

| 字段 | 用途 |
|---|---|
| latest_tweet_id | 每日增量 sync 使用 |
| oldest_tweet_id | 历史回溯参考 |
| last_pagination_token | backfill 中断恢复 |
| backfill_completed | 历史回溯是否跑到底 |

---

### 6.5 `fetch_runs`

用途：记录每次任务运行情况。

```sql
CREATE TABLE fetch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  run_type TEXT NOT NULL,
  account_handle TEXT NOT NULL,

  started_at TEXT NOT NULL,
  finished_at TEXT,

  status TEXT NOT NULL,

  requested_pages INTEGER DEFAULT 0,
  fetched_posts INTEGER DEFAULT 0,
  inserted_posts INTEGER DEFAULT 0,
  duplicated_posts INTEGER DEFAULT 0,

  estimated_post_reads INTEGER DEFAULT 0,
  estimated_user_reads INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,

  error_message TEXT,
  raw_log_path TEXT
);
```

`run_type` 可选值：

```text
resolve_user
backfill
sync
export
status
```

`status` 可选值：

```text
running
success
failed
stopped_by_cost_limit
```

---

### 6.6 `raw_archives` 可选

用途：记录导出的原始文件。

```sql
CREATE TABLE raw_archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_handle TEXT NOT NULL,
  archive_date TEXT NOT NULL,
  file_path TEXT NOT NULL,
  post_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## 7. X API 数据字段建议

第一版抓 posts 时，建议尽量请求以下字段。

### 7.1 Post fields

```text
id
text
created_at
author_id
conversation_id
in_reply_to_user_id
lang
public_metrics
referenced_tweets
entities
```

### 7.2 User fields

```text
id
username
name
description
location
verified
verified_type
public_metrics
created_at
```

### 7.3 Expansions

```text
author_id
referenced_tweets.id
referenced_tweets.id.author_id
```

注意：具体 endpoint 支持哪些字段，以 X Developer Console / 官方文档为准。项目代码里应该允许字段配置，不要硬编码得太死。

---

## 8. 核心命令设计

`package.json` 脚本建议：

```json
{
  "scripts": {
    "db:migrate": "tsx src/db/migrate.ts",
    "x:resolve": "tsx src/jobs/resolve-account.ts",
    "x:backfill": "tsx src/jobs/backfill-account.ts",
    "x:sync": "tsx src/jobs/sync-account.ts",
    "x:export:daily": "tsx src/jobs/export-daily-raw.ts",
    "x:status": "tsx src/jobs/status.ts"
  }
}
```

使用示例：

```bash
pnpm db:migrate
pnpm x:resolve --handle target_blogger
pnpm x:backfill --handle target_blogger --max-pages 5
pnpm x:sync --handle target_blogger
pnpm x:export:daily --handle target_blogger --date 2026-06-09
pnpm x:status --handle target_blogger
```

---

## 9. 功能流程设计

### 9.1 Resolve Account

目标：把 handle 转换成 X user id，并保存用户资料。

输入：

```text
handle = target_blogger
```

输出：

```text
x_user_id
username
name
description
public_metrics
raw_json
```

流程：

```text
1. 读取 handle
2. 调用 X API user lookup
3. 获取 x_user_id
4. upsert watch_accounts
5. upsert x_users
6. 初始化 fetch_cursors
7. 记录 fetch_runs
```

验收标准：

```text
pnpm x:resolve --handle target_blogger
数据库 watch_accounts 中出现 handle 和 x_user_id
数据库 x_users 中出现 raw_json
```

---

### 9.2 Backfill Account

目标：历史回溯，尽量抓取该博主历史 posts。

流程：

```text
1. 读取 handle
2. 查询 watch_accounts 获取 x_user_id
3. 读取 fetch-policy
4. 检查 maxEstimatedCostPerRun
5. 请求用户 posts endpoint
6. 每页 max_results = 100
7. 保存当前页 posts
8. upsert x_posts
9. 更新 fetch_cursors
10. 读取 next_token
11. 有 next_token 则继续下一页
12. 无 next_token 则 backfill_completed = true
13. 完成后记录 fetch_runs
```

成本保护：

```text
预计成本 = maxPagesPerRun × maxResultsPerPage × estimatedPostReadCost
如果预计成本 > maxEstimatedCostPerRun，直接停止
```

示例：

```text
10 页 × 100 posts × $0.005 = $5
```

验收标准：

```text
pnpm x:backfill --handle target_blogger --max-pages 5
可以抓到最多 500 条 posts
重复运行不会重复插入
fetch_runs 记录本次抓取数量和估算成本
```

---

### 9.3 Sync Account

目标：每日增量抓取最新 posts。

流程：

```text
1. 读取 latest_tweet_id
2. 调用用户 posts endpoint
3. 使用 since_id 或时间范围获取新 posts
4. 保存新增 posts
5. 去重
6. 更新 latest_tweet_id
7. 记录 fetch_runs
```

建议频率：

```text
第一阶段手动执行
稳定后每天 1-2 次
```

建议时间：

```text
上午 09:00
晚上 21:00
```

验收标准：

```text
连续执行 3 次不会重复插入
无新 post 时正常结束
有新 post 时可以新增入库
```

---

### 9.4 Export Daily Raw

目标：把指定日期的原始 posts 导出成 ndjson 和 markdown。

输出文件：

```text
exports/raw/{handle}/{YYYY-MM-DD}.ndjson
exports/daily/{handle}/{YYYY-MM-DD}.raw.md
```

NDJSON 示例：

```json
{"tweet_id":"123","created_at":"2026-06-09T01:20:00Z","text":"...","raw_json":{}}
```

Markdown 示例：

```markdown
# target_blogger Raw Posts - 2026-06-09

## Post 1

- Time: 2026-06-09 09:20:00
- Tweet ID: 123
- URL: https://x.com/target_blogger/status/123
- Type: original

Text:

> 原文内容

---
```

验收标准：

```text
pnpm x:export:daily --handle target_blogger --date 2026-06-09
生成 raw ndjson
生成 raw markdown
markdown 可读，包含时间、tweet_id、url、原文
```

---

### 9.5 Status

目标：查看当前账号抓取状态。

输出内容建议：

```text
Account: target_blogger
User ID: xxxxx
Enabled: true
Total Posts Stored: 1234
Latest Tweet ID: xxx
Latest Tweet Time: 2026-06-09T01:20:00Z
Oldest Tweet ID: xxx
Oldest Tweet Time: 2024-01-01T10:00:00Z
Backfill Completed: false
Last Run Status: success
Last Estimated Cost: $0.50
```

验收标准：

```text
pnpm x:status --handle target_blogger
可以清晰看到当前数据状态
```

---

## 10. 成本控制规则

### 10.1 为什么必须做成本控制

X API 是按资源消耗计费。你的项目必须避免：

```text
无限分页
重复抓取
误抓大量账号
误把 sync 写成 backfill
没有上限地跑 cron
```

### 10.2 成本估算公式

```text
Posts Read 成本 = 抓取 posts 数量 × 单条 post 读取成本
User Read 成本 = 读取 user 数量 × 单个 user 读取成本
```

根据当前项目讨论中的价格假设：

```text
Posts Read: $0.005 / post
User Read: $0.010 / user
```

注意：实际价格以你的 X Developer Console 当前页面为准。

### 10.3 第一周建议抓取策略

```text
第 1 次：10 条测试
第 2 次：100 条
第 3 次：500 条
第 4 次：1000 条
之后连续 sync 3-5 天
确认稳定后再继续历史回溯
```

### 10.4 强制保护规则

代码必须支持：

```text
maxPagesPerRun
maxPostsPerRun
maxEstimatedCostPerRun
sleepMsBetweenRequests
```

如果预计成本超过限制：

```text
停止执行
记录 fetch_runs.status = stopped_by_cost_limit
打印明确提示
```

---

## 11. 错误处理设计

### 11.1 API 错误

需要处理：

```text
401 Unauthorized：token 错误或失效
403 Forbidden：权限不足
404 Not Found：账号不存在或不可访问
429 Too Many Requests：rate limit
5xx：X API 服务异常
```

### 11.2 429 处理

```text
1. 打印 rate limit 信息
2. sleep 后重试
3. 超过最大重试次数则停止
4. 保存当前 cursor
5. fetch_runs 记录 failed 或 partial_success
```

### 11.3 数据库错误

需要处理：

```text
tweet_id 冲突：视为 duplicated_posts
数据库文件不存在：提示先运行 db:migrate
写入失败：记录 error_message
```

### 11.4 中断恢复

Backfill 每抓完一页就应该更新：

```text
last_pagination_token
oldest_tweet_id
oldest_tweet_created_at
```

这样中断后可以继续。

---

## 12. 数据原则

### 12.1 原始数据优先

必须永久保存：

```text
raw_json
text
created_at
tweet_id
author_handle
url
public_metrics
referenced_tweets
```

后续所有分析都可以重跑，但原始数据丢了就无法恢复。

### 12.2 总结不是事实源

后续 Agent 的总结、观点、Profile 都只是二级产物。

事实源只有：

```text
x_posts.raw_json
x_posts.text
x_posts.created_at
```

### 12.3 不要覆盖原始数据

如果同一 tweet_id 再次抓到：

```text
保留原始 first_fetched_at
更新 last_fetched_at
可以更新 public_metrics
不要删除 raw_json
```

---

## 13. 开发阶段规划

### Phase 1：项目骨架 + 数据库

任务：

```text
1. 初始化 pnpm 项目
2. 安装 TypeScript / tsx / dotenv / sqlite 相关依赖
3. 创建目录结构
4. 创建 .env.example
5. 创建 config/accounts.json
6. 创建 config/fetch-policy.json
7. 创建数据库 schema
8. 实现 db:migrate
```

验收：

```bash
pnpm install
pnpm db:migrate
```

通过标准：

```text
SQLite 文件创建成功
核心表创建成功
无 TypeScript 编译错误
```

---

### Phase 2：X API Client

任务：

```text
1. 封装 Bearer Token 请求
2. 封装 GET 请求
3. 支持 query params
4. 处理 API 错误
5. 处理 429 rate limit
6. 日志不暴露 token
```

验收：

```text
可以请求一次 X API
失败时错误清晰
不会打印 X_BEARER_TOKEN
```

---

### Phase 3：Resolve Account

任务：

```text
1. 根据 handle 获取 user_id
2. 保存 watch_accounts
3. 保存 x_users
4. 初始化 fetch_cursors
5. 记录 fetch_runs
```

验收：

```bash
pnpm x:resolve --handle target_blogger
```

通过标准：

```text
watch_accounts 有记录
x_users 有记录
fetch_cursors 有记录
```

---

### Phase 4：Backfill 最近 posts

任务：

```text
1. 通过 user_id 抓 posts
2. 支持 max-pages
3. 支持 pagination_token
4. 保存 x_posts
5. 去重
6. 记录成本
7. 更新 cursor
```

验收：

```bash
pnpm x:backfill --handle target_blogger --max-pages 5
```

通过标准：

```text
最多抓 5 页
x_posts 有数据
重复执行不会重复插入
fetch_runs 有成本记录
```

---

### Phase 5：Sync 增量更新

任务：

```text
1. 读取 latest_tweet_id
2. 抓取最新 posts
3. 只插入新增内容
4. 更新 latest_tweet_id
5. 记录 fetch_runs
```

验收：

```bash
pnpm x:sync --handle target_blogger
pnpm x:sync --handle target_blogger
pnpm x:sync --handle target_blogger
```

通过标准：

```text
重复运行不会重复插入
无新增时正常结束
有新增时能入库
```

---

### Phase 6：Daily Export

任务：

```text
1. 按日期查询 posts
2. 导出 ndjson
3. 导出 markdown
4. 记录 raw_archives
```

验收：

```bash
pnpm x:export:daily --handle target_blogger --date 2026-06-09
```

通过标准：

```text
生成 ndjson
生成 raw.md
markdown 可读
```

---

### Phase 7：Status 命令

任务：

```text
1. 查询账号状态
2. 查询 posts 总数
3. 查询 latest / oldest post
4. 查询最近一次 fetch_run
5. 打印 backfill 状态
```

验收：

```bash
pnpm x:status --handle target_blogger
```

通过标准：

```text
可以清晰看到当前抓取进度、总数量、最近运行状态
```

---

## 14. 第一周执行计划

### Day 1

目标：项目骨架 + 数据库。

```text
完成 Phase 1
```

### Day 2

目标：X API 跑通。

```text
完成 Phase 2 + Phase 3
能够 resolve handle
```

### Day 3

目标：小规模抓取。

```text
抓 10 条
抓 100 条
检查数据结构
检查 raw_json
```

### Day 4

目标：Backfill 500-1000 条。

```text
完成 Phase 4
检查去重
检查成本记录
```

### Day 5

目标：增量 sync。

```text
完成 Phase 5
连续运行多次
确认无重复数据
```

### Day 6

目标：导出 raw 文件。

```text
完成 Phase 6
生成 daily raw.md
生成 ndjson
```

### Day 7

目标：稳定性观察。

```text
手动 sync
检查 fetch_runs
检查成本
检查数据完整性
决定是否继续扩大历史回溯
```

---

## 15. Vibe Coding Prompt

可以直接把下面这段发给 Coding Agent。

```text
你现在负责创建一个 TypeScript + SQLite 项目，项目名 market-watcher-core。

项目目标：
通过 X API 抓取指定公开账号的 posts，保存原始数据，支持历史 backfill、每日 sync、去重、成本估算和 raw markdown / ndjson 导出。

第一版只做数据抓取和存储，不做 LLM 分析，不做 Market Thinking Profile，不做 UI，不做多用户系统。

核心要求：
1. 使用 Node.js + TypeScript。
2. 使用 SQLite 存储数据。
3. 使用 dotenv 管理 X_BEARER_TOKEN。
4. 支持 config/accounts.json 配置要抓取的账号。
5. 支持 config/fetch-policy.json 控制 maxPagesPerRun、maxPostsPerRun、maxEstimatedCostPerRun。
6. 提供命令：
   - pnpm db:migrate
   - pnpm x:resolve --handle xxx
   - pnpm x:backfill --handle xxx --max-pages 5
   - pnpm x:sync --handle xxx
   - pnpm x:export:daily --handle xxx --date YYYY-MM-DD
   - pnpm x:status --handle xxx
7. 数据库至少包含：
   - watch_accounts
   - x_users
   - x_posts
   - fetch_cursors
   - fetch_runs
8. x_posts 必须保存 raw_json。
9. tweet_id 必须唯一，重复运行不能重复插入。
10. 每次运行必须记录抓取页数、获取 posts 数、新增 posts 数、重复 posts 数、预估成本。
11. 必须有成本保护。如果预计成本超过 maxEstimatedCostPerRun，停止运行。
12. 先实现本地运行，不要做部署，不要做 UI。

开发顺序：
Phase 1：项目骨架 + SQLite schema
Phase 2：X API Client
Phase 3：resolve handle -> user_id
Phase 4：backfill 最近 posts
Phase 5：sync 增量更新
Phase 6：导出 daily raw markdown / ndjson
Phase 7：status 命令查看当前抓取状态

请按阶段实现，每完成一个阶段先给我运行命令和验收方式。
```

---

## 16. 后续 Market Watcher Agent 阶段预留

Core 跑稳定后，再进入第二阶段。

第二阶段新增内容：

```text
post_analysis
daily_digest
market_view_change_log
forecast_ledger
blogger_profile.md
```

第二阶段能力：

```text
每日总结
观点分类
观点变化追踪
预测账本
Market Thinking Profile
Hermes Daily Note 集成
```

第二阶段输入源：

```text
x_posts 表
exports/daily/*.raw.md
exports/raw/*.ndjson
```

---

## 17. 最终验收清单

Market Watcher Core v0.1 完成时，需要全部满足：

```text
[ ] 可以配置一个 X 博主 handle
[ ] 可以解析 handle 对应的 user_id
[ ] 可以抓取最近 N 条 posts
[ ] 可以分页 backfill
[ ] 可以每日 sync
[ ] tweet_id 去重正常
[ ] raw_json 已保存
[ ] created_at 已保存
[ ] text 已保存
[ ] url 已保存
[ ] public_metrics 已保存
[ ] fetch_runs 能记录每次运行
[ ] fetch_cursors 能记录断点
[ ] 成本估算正常
[ ] 超过成本限制会停止
[ ] 可以导出 daily raw.md
[ ] 可以导出 daily ndjson
[ ] status 命令可查看状态
[ ] 连续运行 3-5 天无重复、无异常成本、无数据丢失
```

---

## 18. 关键原则总结

```text
先拿原始数据，再做 Agent。
先稳定抓取，再做分析。
先单博主，再多博主。
先本地跑，再考虑部署。
先 raw_json，再 profile。
```

Market Watcher Core 的第一阶段只有一个使命：

```text
建立一个可靠、可追溯、可增量更新的 X 原始言论数据库。
```
