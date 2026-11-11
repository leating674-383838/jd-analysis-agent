# Ganzee · 岗见 — 运营手册

> 最后更新：2026-04-17
> 数据来源：Supabase → ai_logs 表

---

## 一、每日监控

打开 Supabase Dashboard → Table Editor → SQL Editor，执行以下查询。

### 今日成功率

```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
  ROUND(
    100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 1
  ) AS success_rate_pct
FROM ai_logs
WHERE created_at >= CURRENT_DATE;
```

### 今日平均延迟

```sql
SELECT ROUND(AVG(latency_ms)) AS avg_ms
FROM ai_logs
WHERE created_at >= CURRENT_DATE AND status = 'success';
```

### 近 7 天趋势（延迟 + 成功率）

```sql
SELECT
  DATE(created_at) AS date,
  COUNT(*) AS total,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
  ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate_pct,
  ROUND(AVG(latency_ms)) AS avg_latency_ms
FROM ai_logs
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### 风险识别检出率（近 7 天）

```sql
SELECT
  DATE(created_at) AS date,
  COUNT(*) AS total,
  SUM(
    CASE WHEN output_json->'risk_alerts' @> '["无"]'::jsonb THEN 0 ELSE 1 END
  ) AS risk_detected_count,
  ROUND(
    100.0 * SUM(
      CASE WHEN output_json->'risk_alerts' @> '["无"]'::jsonb THEN 0 ELSE 1 END
    ) / NULLIF(COUNT(*), 0), 2
  ) AS risk_detection_rate_pct
FROM ai_logs
WHERE status = 'success'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

> ⚠️ 风险检出率 ≠ 准确率，真实准确率需人工抽样。建议每月抽 100 条复核。
> 参考基线：30-50% 为合理区间。

### 全量汇总

```sql
SELECT
  COUNT(*) AS total_calls,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS total_success,
  ROUND(AVG(latency_ms)) AS avg_latency_ms,
  ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate_pct,
  COUNT(DISTINCT user_id) AS unique_users
FROM ai_logs;
```

---

## 二、告警阈值

| 指标 | 正常 | 注意 | 告警 |
|------|------|------|------|
| 成功率 | > 95% | 85-95% | < 85% 持续 1 小时 |
| 平均延迟 | < 8s | 8-15s | > 15s 持续 10 次 |
| 风险检出率 | 30-50% | < 20% 或 > 70% | 异常需排查 prompt |
| 日活用户 | 正常波动 | — | 异常暴增需排查薅羊毛 |

---

## 三、配额策略

| 版本 | 游客/日 | 登录用户/日（非首次登录日） | 首次登录日 | 管理员 | 调整原因 |
|------|------|---------|---------|--------|---------|
| V1.0 | 3次 | 13次 | 16次 | 不限 | 初始设定 |
| V2.0 | 3次 | 5次，与游客共享池子（游客用多少登录后从剩余算） | 8次，同样共享池子 | 不限 | 明确共享池逻辑，修复前端次数叠加bug |

> 每次调整在此表追加一行，注明原因。
**重置机制：** 次数按用户设备本地时间自然日重置（0点00分）。游客次数存于本地 localStorage，登录用户次数以ai_logs 数据库记录为准。
**已知限制：** 依赖客户端时间，存在跨时区或手动调时绕过的可能，现阶段可接受。
---

## 四、薅羊毛处理

发现 device_id 异常集中时：

```sql
-- 查某 device_id 的使用记录
SELECT * FROM ai_logs
WHERE device_id = '目标device_id'
ORDER BY created_at DESC;
```

处理步骤：
1. 确认 ai_logs 中该 device_id 使用量异常
2. Supabase → Authentication → Users → 找到对应用户 → Disable
3. 在下方异常事件记录里记一行

---

## 五、成本估算

| 项目 | 数值 |
|------|------|
| 模型 | moonshot-v1-8k (Kimi) |
| 每次消耗 | 约 800 input + 300 output = 1100 tokens |
| 单价 | 约 ¥0.012 / 1k tokens |
| 每次成本 | 约 ¥0.013 |
| 100次/天 | 约 ¥1.3/天 ≈ ¥40/月 |

> 实际成本以 Kimi 控制台账单为准，每月核对一次。

---

## 六、异常事件记录

| 日期 | 事件描述 | 处理方式 | 结果 |
|------|---------|---------|------|
| — | — | — | — |

> 发现异常就在此表追加一行。

---

## 版本信息

| 字段 | 值 |
|------|----|
| 模型 | moonshot-v1-8k (Kimi) |
| 企业搜索 | Serper Google Search API |
| 数据存储 | Supabase (PostgreSQL) |
| Prompt 版本 | V2.1 |
| 文档版本 | V2.0 |
| 创建日期 | 2026-04-15 |