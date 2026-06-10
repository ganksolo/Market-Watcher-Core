# Market Watcher Core 收口修复 TODO

## 状态

已完成。

这份文档保留最终执行结果，用于说明此前收口问题已经全部修复完毕。

---

## P0

- [x] 统一 handle 规范化，支持带或不带 `@` 输入
- [x] 补齐 `fetch_cursors` 的最新/最旧 `created_at` 边界字段
- [x] 完成成本控制闭环，落实 `maxPagesPerRun`、`maxPostsPerRun`、`maxEstimatedCostPerRun`
- [x] 修正重复 tweet 更新策略，重复抓取时刷新 `last_fetched_at`
- [x] 升级 raw export，使 Agent 可直接消费
- [x] 补全 `x:status` 关键验收信息

---

## P1

- [x] 将 `enabled` / `label` 接入账号管理闭环
- [x] 完善错误分类、失败记录与错误文案展示
- [x] 补齐基础可验证测试，覆盖成本、handle、配置、错误分类、格式化等核心逻辑

---

## P2

- [x] 重复抓取时刷新 `text`
- [x] 重复抓取时刷新六个 `public_metrics` 字段
- [x] `x:resolve` 时同步 `label` 到数据库
- [x] `status` 中最近错误做轻量可读化展示

---

## 备注

- 当前项目已通过收口复核，详见 `/Users/jiayulong/Development/Market-Watcher-Core/docs/audit-report.md`
- 如后续进入 Agent 阶段，建议把新增需求单独放入新 phase 文档，不再继续复用这份收口 TODO
