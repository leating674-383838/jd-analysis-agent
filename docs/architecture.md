# 岗见 · 系统技术设计（TDD）

本文档架构：技术栈→分工→数据流→安全→API→部署

项目: JD Analysis Web App　版本: V1.0.0　最后更新: 2026.03.29　作者：Nirvana

## 1. 技术架构 (System Architecture)

### 1.1 架构概览

- 整体架构模式为 **前后端分离**
- 核心技术栈清单

| 层级 | 技术选型 | 说明 | 版本 |
| --- | --- | --- | --- |
| 前端 | React + TypeScript + Vite | 仅负责托管前端静态资源和页面路由，保持客户端轻量化。通过Supabase JS SDK和Edge Functions交互 | V1.0.0 |
| 后端 | Supabase (Auth + Postgres + Storage + Edge Functions)+Serper API | 所有业务逻辑、认证校验、信息抓取及AI解析等能力全部在 Supabase 中实现。外部服务：Serper API 抓取企业动态 | V1.0.0 |
| AI层 | DeepSeek | 解析JD结构、提取关键信息、二次清洗Serper返回数据 | V1.0.0 |
| 数据库 | Supabase Postgres | 存储用户历史解析记录，RLS确保用户数据隔离 | V1.0.0 |
| 部署 | Vercel | 托管前端静态资源，自动化CI/CD部署 | V1.0.0 |

### 1.2 系统架构图

- 各模块之间的调用关系（用文字描述或图示）

```text
前端 ↓
Edge Function ↓
LLM ↓
Serper
```

- 数据流向：用户输入 → 前端 → API → AI模块 → 数据库 → 返回

```text
用户输入公司名称+JD信息（用户触发解析）
Edge Function
调用LLM→对文本进行拆解分析 + 调用 Serper API →抓取企业动态
AI二次清洗处理
HTTP Response返回前端
React State存入结果
前端判断登录状态
↓                      ↓
未登录：停在React State   已登录：调用Supabase写入数据库
显示解析内容
```

```text
1 接收参数
  company_name
  jd_text

2 文本清洗
  remove html
  remove empty lines

3 调用 Serper
  query company_name

4 调用 LLM
  input:
     jd_text
     company_info

5 AI解析

6 返回 JSON
```

### 1.3 外部依赖

- 第三方API清单（名称、用途、限制、降级方案）

| 名称 | 用途 | 限制 | 降级方案 |
| --- | --- | --- | --- |
| **deepseek** | JD解析、二次清洗Serper数据 | 待查：Token上限、RPM限制、免费额度 | 待定：备选模型或提示用户稍后重试 |
| **Serper** | 企业信息搜索 | 待查：每月免费搜索次数 | 待定：返回空时提示用户手动补充企业信息 |

---

## 2. AI集成设计 (AI Integration)

> AIPM重点区，TDD里含金量最高的部分

### 2.1 AI调用链路

1. 触发条件：用户点击解析按钮
2. 调用方式：同步，前端收到完整JSON后逐字渲染（同步+前端动画）
3. 超时设置：
   - 连接超时：5~10 秒（如果 10 秒都连不上模型接口，直接判定网络故障）。
   - 读取超时 (TTFT)：即“首字返回时间”。如果 30 秒内模型一个字都没吐出来，应切断连接并提示用户“服务器繁忙”。
   - 总时长超时：设置60S。
4. 重试策略：
   - 可重试错误：HTTP 429 (Rate Limit)：频率限制。策略：指数退避（等 1s, 2s, 4s 后再试）。
   - 不可重试错误：HTTP 400 (Bad Request)：Prompt 过长、内容违规、参数错误。这种错误重试一万次也没用，直接报错给用户。

### 2.2 上下文管理

- 会话状态怎么维护（无状态/有状态）
  - 无状态，每次调用独立
- Token用量控制策略
  - 每次只传当前JD内容，不累积历史消息
- 历史消息截断规则
  - 不需要，没有没有多轮对话累积的历史信息，不需要截断规则

### 2.3 成本与性能

- 预估Token消耗
  - 输入≈750 Token
  - 输出≈530 Token
  - 总预估消耗在1300 Token
- 响应延迟目标（P50/P95）
  - P50目标：35秒（大多数情况下的体验）
  - P95目标：55秒（较慢但不超时）
  - 超过60秒：触发超时报错
- 限流策略（已实现）
  - 游客：每天最多3次解析，按设备维度原子扣减，解析失败自动退回次数
  - 登录用户：每天最多5次解析；注册当天可叠加游客次数
  - 管理员不受限
  - 5分钟内同一岗位重复提交覆盖不新增

---

## 3. 数据库设计 (Database Schema)

### 3.1 表结构定义

常规命名规则：全小写、下划线分隔、用名词复数。

- 表名：用户信息表 users
  - 存用户账户数据

| 字段名 | 类型 | 是否必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | 是 | auth.uid() | 主键 |
| created_at | timestamp | 是 | now() | 创建时间 |
| user_ip_address | string | 是 | 无默认值（系统自动捕获，不…（原文截断） | 用户IP |
| user_login_time | timestamp | 是 | now() | 用户登录时间 |
| user_logout_time | timestamp | 是 | now() | 用户退出时间 |

- 表名：解析历史表 analysis_records
  - 存每次解析的结果快照

| 字段名 | 类型 | 是否必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | 是 | auth.uid() | 主键 |
| user_id | uuid | 是 | 无默认值（登录用户才能写入这张表） | 关联用户 |
| created_at | timestamp | 是 | now() | 创建时间 |
| **title** | string | 否 | (null) | 提取出的标准职位名称。必须去除非法字符。 |
| **category** | string | 否 | (null) | AI自由识别，格式固定为"岗位名称-细分类型"，不超过15字 |
| **risk_alerts** | text[] | 否 | (null) | 风险点列表。若无风险返回 ["无"]，严禁返回空数组 []。 |
| **insight** | string | 否 | (null) | 50-150字深度解析。重点在“企业真实需求”。 |
| **company_brief** | string | 否 | (null) | 100字企业背景。必须结合 Serper 搜索结果，严禁胡编。 |
| **analysis_status** | enum | 是 | PENDING | 解析状态（解析成功/解析失败） |

- 表名：备忘录表 notes
  - 存用户的文本备忘内容

| 字段名 | 类型 | 是否必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | 是 | auth.uid() | 主键 |
| user_id | uuid | 是 | 无默认值（登录用户才能写入这张表） | 关联用户 |
| created_at | timestamp | 是 | now() | 创建时间 |
| content | JSON | 是 | 无默认值 | 备忘录内容（含所有…（原文截断） |
| deleted_at | timestamp | 否 | (null) | 删除时间（软…（原文截断） |

### 3.2 表关系说明

1. 主外键关系
   - 解析历史表的user_id关联用户表的id，备忘录表的user_id关联用户表的id
2. 索引设计及原因

| 表 | 索引字段 | 原因 |
| --- | --- | --- |
| 解析历史表 | user_id | 用户查自己的历史记录时按user_id筛选，加索引加速查询 |
| 解析历史表 | created_at | 历史记录按时间排序，加索引加速排序 |
| 备忘录表 | user_id | 同上 |

### 3.3 数据生命周期

- 数据保留策略（多久清理/归档）
  - 解析历史：保留30天，到期自动清理
  - 备忘录：永久保存，用户主动删除才清除（软删除，deleted_at字段标记）
- 敏感数据处理方式
  - 敏感数据：用户IP不对外展示，仅后台记录

---

## 4. 安全设计 (Security Design)

### 4.1 RLS规则

**作用表：用户信息表**

操作类型：INSERT、SELECT
规则逻辑：当前登录用户ID等于数据的user_id
边界情况：未登录用户无法操作

```sql
-- 用户信息表
CREATE POLICY " 用户只能读取自己的信息" ON users FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY " 用户只能创建自己的信息" ON users FOR INSERT WITH CHECK (auth.uid() = user_id);
```

**作用表：解析历史表**

操作类型：INSERT、SELECT、DELETE
规则逻辑：当前登录用户ID等于数据的user_id
边界情况：未登录用户无法操作

```sql
-- 解析历史表
CREATE POLICY "用户只能读取自己的历史" ON analysis_records FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "用户只能创建自己的历史" ON analysis_records FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "用户只能删除自己的历史" ON analysis_records FOR DELETE USING (auth.uid() = user_id);
```

**作用表：备忘录表**

操作类型：INSERT、SELECT、UPDATE、DELETE
规则逻辑：当前登录用户ID等于数据的user_id
边界情况：未登录用户无法操作

```sql
-- 备忘录表
CREATE POLICY "用户只能读取自己的备忘录" ON memos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "用户只能创建自己的备忘录" ON memos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "用户只能更新自己的备忘录" ON memos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "用户只能删除自己的备忘录" ON memos FOR DELETE USING (auth.uid() = user_id);
```

### 4.2 认证与鉴权

- 认证方式（JWT/Session/OAuth）
  - JWT，由Supabase Auth管理
- 权限分级（角色定义）
  - 两个角色——游客（未登录）、注册用户（已登录）
- Token过期与刷新策略
  - access token有效期1小时，过期后用refresh token自动续期，无需用户重新登录

| 场景 | 策略 |
| --- | --- |
| 普通用户长期使用 | access token短期（1小时），refresh token长期（30天），自动续期…（原文截断） |
| 安全敏感场景（金融/医疗） | access token极短（15分钟），不自动续期，强制重新登录 |
| 长时间未活跃 | 超过N天没有任何操作，refresh token失效，强制重新登录 |
| 多设备登录 | 新设备登录后，旧设备token立即失效 |
| 用户主动退出 | 立即销毁token，不可续期 |

---

## 5. API接口协议 (API Specification)

### 5.1 接口清单

| 接口名 | 操作场景 | Method |
| --- | --- | --- |
| 触发JD解析 | 用户点击分析按钮 | POST |
| 重新解析 | 用户点击重新生成 | PUT |
| 用户登录 | 用户登录 | POST |
| 新建备忘录 | 点击新建备忘录 | POST |
| 保存备忘录 | 点击保存 | PUT |
| 查看历史记录 | 进入历史页面 | GET |
| 删除历史记录 | 点击删除历史 | DELETE |
| 删除备忘录 | 点击删除备忘录 | DELETE |

### 5.2 接口详细定义

**接口名称：触发JD解析**

- Method：POST
- Path：/functions/v1/analyze-jd
- 认证要求：登录用户和游客都可以调

**Request：**

所以Request字段是：

```json
{
   "company_name": "string，必填, 公司名称",
   "job_title": "string, 必填, 岗位名称",
   "jd_content": "string，必填, JD原文",
   "user_id": "string, 选填, 已登录用户传入"
}
```

**Response（成功）：**

```json
{
    "code": 200,
    "data": {
     "title": "AI平台产品经理",
     "category": "平台型",
     "risk_alerts": ["高薪", "收小白"],
     "insight": "该岗位实际需要...",
     "company_brief": "字节跳动成立于...",
     "analysis_status": "成功"
    }
}
```

**Response（失败）：**

```json
{
    "code": 500,
    "error": "AI_SERVICE_ERROR",
    "message": "AI 接口调用失败"
}
```

**Response（失败）：**

```json
{
    "code": 500,
    "error": "SEARCH_SERVICE_ERROR",
    "message": "Serper接口调用失败"
}
```

**Response（失败）：**

```json
{
    "code": 500,
    "error": "DATABASE_ERROR",
    "message": "数据库写入失败"
}
```

**Response（失败）：**

```json
{
    "code": 500,
    "error": "TIMEOUT",
    "message": "请求超时"
}
```

**Response（失败）：**

```json
{
    "code": 400,
    "error": "MISSING_FIELD",
    "message": "JD 内容不能为空"
}
```

**Response（失败）：**

```json
{
    "code": 429,
    "error": "RATE_LIMIT_EXCEEDED",
    "message": "超过使用次数限制"
}
```

### 5.3 错误码规范

| 错误码 | 错误标识 | 含义 | 处理建议 |
| --- | --- | --- | --- |
| 400 | MISSING_FIELD | 请求参数错误 | 提示用户检查输入格…（原文截断） |
| 401 | UNAUTHORIZED | 未登录 | 弹登录提示 |
| 429 | RATE_LIMIT_EXCEEDED | 超过使用次数限制 | 提示今日次数已用完…（原文截断） |
| 500 | AI_SERVICE_ERROR | AI接口调用失败 | 中断解析，提示用户'解析失败，…（原文截断） |
| 500 | SEARCH_SERVICE_ERROR | Serper接口调用失败 | 跳过公司内容的检索直接到下…（原文截断） |
| 500 | DATABASE_ERROR | 数据库写入失败 | 结果正常展示但提示保存…（原文截断） |
| 500 | TIMEOUT | 请求超时 | 提示网络超时，请重新…（原文截断） |

---

## 6. 部署架构 (Deployment)

### 6.1 环境配置

| 环境 | 用途 | 域名/地址 |
| --- | --- | --- |
| Development | 本地开发调试 | localhost:5173前期用后期已改用vercel |
| Production | 线上用户使用 | Vercel分配的域名 |

### 6.2 密钥管理

- 前端只持有 Supabase 项目地址与 anon（公开）密钥，通过构建时环境变量注入。
- 大模型与搜索服务的密钥、数据库的 service role 密钥只存在于 Supabase Edge Function 的服务端 Secrets 中，前端永远拿不到。
- 禁止：前端代码写密钥、提交密钥到 GitHub、配置文件硬编码生产密钥。

### 6.3 发布流程

- 代码合并→构建→部署步骤
  - 前端：本地代码 → 推送GitHub → Vercel自动构建部署
  - Edge Functions：本地开发 → Supabase CLI推送 → 自动生效
  - 数据库：Supabase控制台直接操作表结构
