# Market Watcher Core

本地 CLI 数据采集工具：从 X/Twitter API v2 拉取指定账号的推文，存入 SQLite，并导出为 ndjson / markdown。

无 LLM 分析、无 UI、无部署——仅做原始数据采集。

---

## 前置条件

- Node.js 22+
- pnpm
- X API v2 Bearer Token（[申请地址](https://developer.x.com/en/portal/dashboard)）

---

## 安装

```bash
pnpm install
```

复制并填写环境变量：

```bash
cp .env.example .env
# 编辑 .env，填入 X_BEARER_TOKEN
```

初始化数据库（首次运行必须执行）：

```bash
pnpm db:migrate
```

---

## 配置

### `config/accounts.json` — 要追踪的账号

```json
{
  "accounts": [
    {
      "handle": "example_handle",
      "label": "备注名称",
      "enabled": true,
      "note": "可选说明"
    }
  ]
}
```

### `config/fetch-policy.json` — 抓取策略

| 字段 | 默认值 | 说明 |
|---|---|---|
| `maxResultsPerPage` | 100 | 每页最大条数（X API 上限） |
| `maxPagesPerRun` | 10 | 每次运行最多抓取页数 |
| `includeReplies` | true | 是否包含回复推文 |
| `includeRetweets` | false | 是否包含转推 |
| `includeQuotes` | true | 是否包含引用推文 |
| `sleepMsBetweenRequests` | 1200 | 请求间隔（毫秒） |
| `maxEstimatedCostPerRun` | 5 | 单次运行最大预估费用（USD） |

---

## 使用流程

```
1. x:resolve   —— 解析 handle → xUserId，写入 DB
2. x:backfill  —— 全量历史抓取（支持断点续传）
3. x:sync      —— 增量同步（仅拉取新推文）
4. x:export    —— 导出指定日期为 ndjson + markdown
5. x:status    —— 查看账号抓取状态
```

### 1. 解析账号

```bash
pnpm x:resolve --handle <handle>
```

### 2. 历史全量抓取

```bash
pnpm x:backfill --handle <handle>
# 限制页数（用于测试）
pnpm x:backfill --handle <handle> --max-pages 3
```

崩溃后可直接重跑，自动从上次断点续传。

### 3. 增量同步

```bash
pnpm x:sync --handle <handle>
```

需先完成 backfill。每次 sync 只拉取上次最新推文之后的新内容。

### 4. 导出指定日期

```bash
pnpm x:export:daily --handle <handle> --date YYYY-MM-DD
```

输出文件：
- `exports/raw/<handle>/<date>.ndjson` — 每行一条原始 X API JSON
- `exports/daily/<handle>/<date>.md` — Markdown 列表格式

### 5. 查看状态

```bash
pnpm x:status --handle <handle>
```

示例输出：

```
Account:   @example_handle
User ID:   123456789
Posts:     1842 total
Backfill:  completed ✓
Latest:    1799xxxxxxxxxxxxxxx
Oldest:    1700xxxxxxxxxxxxxxx

Last run:  sync · success · 3 inserted · 2026-06-09T14:35:00.000Z
```

---

## 数据库结构

| 表 | 内容 |
|---|---|
| `watch_accounts` | 追踪账号列表 |
| `x_users` | X 用户信息快照 |
| `x_posts` | 推文数据（`tweet_id` UNIQUE） |
| `fetch_cursors` | 抓取进度游标（backfill 断点 + sync 锚点） |
| `fetch_runs` | 每次运行记录（状态、费用、条数） |
| `raw_archives` | 导出历史记录 |

数据库默认路径：`data/market-watcher.sqlite`（可通过 `DATABASE_URL` 修改）。

---

## 成本保护

每次 API 调用前预估费用：`(pagesCount + 1) × maxResultsPerPage × estimatedPostReadCost`。超过 `maxEstimatedCostPerRun` 时自动停止，run 状态记录为 `stopped_by_cost_limit`。

---

## 目录结构

```
config/           抓取策略与账号配置
src/
  clients/        X API v2 HTTP 客户端
  db/             Schema、migrate、Drizzle 单例
  jobs/           CLI 入口（resolve / backfill / sync / export / status）
  services/       DB 操作封装（account / post / cursor / run-log）
  utils/          logger、cli arg、date、sleep
exports/          导出文件（gitignored）
data/             SQLite 数据库（gitignored）
logs/             运行日志（gitignored）
```
