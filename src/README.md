# 代码节选（仅供展示）

这里只放能说明技术落地的几个文件，不是完整可运行的工程：

| 文件 | 说明 |
|---|---|
| `supabase/functions/analyze-jd/index.ts` | 后端核心：输入校验 → 游客 / 登录用户限流（含失败退回）→ Serper 公司检索 → DeepSeek 解析 → JSON 提取与字段校验 → `ai_logs` 记录。System Prompt 已省略 |
| `lib/supabase.ts` | 前端 Supabase 客户端，密钥从环境变量读取 |
| `lib/fingerprint.ts` | 设备指纹，用于游客维度限流 |
| `pages/Login.tsx` | 手机号验证码登录页 |
