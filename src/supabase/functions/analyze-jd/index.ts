// 展示用节选：Edge Function 流程骨架（校验 → 限流 → 公司检索 → 模型调用 → 校验 → 日志）。
// 为防复制，System Prompt 已替换为占位符。
// supabase/functions/analyze-jd/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEEPSEEK_KEY         = Deno.env.get('DEEPSEEK_KEY') ?? '';
const SERPER_KEY           = Deno.env.get('SERPER_KEY') ?? '';
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ── 次数限制（与前端保持一致）──
const USER_LIMIT  = 5;
const GUEST_LIMIT = 3;

// ── 前置输入校验 ──
function validateJdInput(jd: string): { valid: boolean; reason?: string } {
  const clean = jd.trim();
  if (clean.length < 15) return { valid: false, reason: '输入内容太短，无法分析' };
  const jdKeywords = ['岗位','职责','要求','任职','技能','薪资','招聘','负责','背景','经验','工作','团队'];
  const hasKeyword = jdKeywords.some(k => clean.includes(k));
  const cnCount = (clean.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (cnCount < 5 && !hasKeyword) {
    return { valid: false, reason: '请粘贴具体的岗位描述内容' };
  }
  return { valid: true };
}

function extractJSON(text: string) {
  try {
    return JSON.parse(text);
  } catch {}

  // 只取最后一个大括号块（更稳定）
  const lastStart = text.lastIndexOf('{');
  const lastEnd   = text.lastIndexOf('}');
  if (lastStart === -1 || lastEnd === -1 || lastEnd <= lastStart) return null;

  try {
    return JSON.parse(text.slice(lastStart, lastEnd + 1));
  } catch {
    return null;
  }
}

// ── System Prompt（已省略）──
// 完整 Prompt 不在展示仓库公开，结构与约束见 docs/prompt-iteration.md。
const SYSTEM_PROMPT = `[omitted for showcase]`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startMs  = Date.now();
  let logStatus  = 'fail';
  let logInput   = '';
  let logOutput: any = null;
  let logUserId: string|null = null;

  try {
    const { company_name, job_title, jd_content, user_id, device_id } = await req.json();
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const today = now.toISOString().slice(0, 10);
    logUserId = user_id ?? null;
    logInput  = jd_content ?? '';

    if (!company_name || !job_title || !jd_content) {
      return jsonError('缺少必要参数：company_name、job_title、jd_content', 400);
    }

    const validation = validateJdInput(jd_content);
    if (!validation.valid) {
      return jsonError(validation.reason ?? '输入内容无效', 422, { analysis_status: 'FAILED' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── 管理员检查 ──
    let isAdmin = false;
    if (user_id) {
      const { data: ud } = await supabase.from('users').select('role').eq('id', user_id).single();
      isAdmin = ud?.role === 'admin';
    }

    // ── 游客设备维度限流（原子）──
    if (!user_id) {
      const { data: allowed, error } = await supabase.rpc(
        'consume_guest_quota',
        {
          p_device_id: device_id,
          p_date: today,
        }
      );

      if (error) {
        console.error('guest quota rpc error:', error);
        return jsonError('配额系统异常', 500);
      }

      if (!allowed) {
        return jsonError('今日游客配额已用完', 429);
      }
    }

    // ── 登录用户账号维度限流 ──
    if (user_id && !isAdmin) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const { count: dbCount } = await supabase.from('ai_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .eq('status', 'success')
        .gte('created_at', todayStart.toISOString());
      const dbUsed = dbCount ?? 0;
      const { data: dq } = await supabase
        .from('device_quota')
        .select('used')
        .eq('device_id', device_id)
        .eq('date', today)
        .maybeSingle();
      const guestUsed = dq?.used ?? 0;
      const totalUsed = dbUsed + guestUsed;
      const { data: userInfo } = await supabase.from('users')
        .select('created_at').eq('id', user_id).maybeSingle();
      const isFirstDay = userInfo?.created_at
        ? new Date(userInfo.created_at).toDateString() === new Date().toDateString()
        : false;
      const limit = isFirstDay ? (GUEST_LIMIT + USER_LIMIT) : USER_LIMIT;
      if (totalUsed >= limit) {
        return jsonError('今日配额已用完', 429);
      }
    }

    // ── Serper 企业信息 ──
    let serperResult = '';
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${company_name} 公司介绍 主营业务`, gl: 'cn', hl: 'zh-cn', num: 5 }),
      });
      const d = await res.json();
      serperResult = (d.organic ?? []).slice(0, 3)
        .map((r: any) => r.snippet ?? '').filter(Boolean).join(' ').slice(0, 600);
    } catch (err) {
      console.error(err);
    }

    const cleanJd = jd_content.replace(/\s+/g, ' ').trim().slice(0, 800);

    // ── 单次调用：直接传原始JD + 公司背景 ──
    const userMessage = `
【公司名称】
${company_name}

【岗位名称】
${job_title}

【公司背景（来自搜索）】
${serperResult || '未找到公开信息'}

【完整JD原文】
${cleanJd}

请按照分析思路对以上JD进行深度拆解，输出JSON结果。
    `.trim();

  try {

    // ── 调用 DeepSeek ──
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 1,
        max_tokens: 800,
      }),
    });

    if (!res.ok) throw new Error(`AI请求失败: ${res.status}`);

    const d = await res.json();
    const raw = d.choices?.[0]?.message?.content ?? '';
    const clean = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // ── 解析JSON ──
    const parsed = extractJSON(clean);

    if (!parsed) {
      throw new Error('AI返回格式异常');
    }

    if (!parsed.title || !parsed.insight) {
      throw new Error('AI输出字段缺失');
    }

    // ── 构造最终结果 ──
    const isSuccess = parsed.analysis_status === 'SUCCESS';

    const result = isSuccess ? {
      title: parsed.title,
      category: parsed.category,
      risk_alerts: parsed.risk_alerts,
      insight: parsed.insight,
      company_brief: parsed.company_brief || '暂未找到该公司公开信息',
      analysis_status: 'SUCCESS',
    } : {
      title: parsed.title || '无法识别',
      category: parsed.category || '未知类型',
      risk_alerts: parsed.risk_alerts?.length > 0 ? parsed.risk_alerts : ['无'],
      insight: parsed.insight,
      company_brief: parsed.company_brief || '暂未找到该公司公开信息',
      analysis_status: 'FAILED',
    };

    logStatus = isSuccess ? 'success' : 'fail';
    logOutput = result;

    // ── 失败时退回游客次数 ──
    if (!isSuccess && !user_id && device_id) {
      try {
        await supabase.rpc('refund_guest_quota', {
          p_device_id: device_id,
          p_date: today,
        });
      } catch (refundErr) {
        console.error('refund quota failed:', refundErr);
      }
    }

    // ── 写入 ai_logs ──
    try {
      await supabase.from('ai_logs').insert({
        user_id: logUserId,
        device_id: device_id,
        input_text: logInput.slice(0, 800),
        output_json: logOutput,
        latency_ms: Date.now() - startMs,
        model_name: 'deepseek-chat',
        status: logStatus,
      });
    } catch (err) {
      console.error(err);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {

    console.error('AI解析失败:', err);

    // ── 游客失败退回次数 ──
    if (!user_id && device_id) {
      try {
        await supabase.rpc('refund_guest_quota', {
          p_device_id: device_id,
          p_date: today,
        });
      } catch (refundErr) {
        console.error('refund quota failed:', refundErr);
      }
    }

    throw err;
  }

  } catch (err: any) {
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      await sb.from('ai_logs').insert({
        user_id:     logUserId,
        input_text:  logInput.slice(0, 800),
        output_json: null,
        latency_ms:  Date.now() - startMs,
        model_name:  'deepseek-chat',
        status:      'fail',
      });
    } catch (err) {
      console.error(err);
    }
    return jsonError(err.message ?? '服务器错误', 500);
  }
});

function jsonError(msg: string, status: number, extra: object = {}) {
  return new Response(
    JSON.stringify({ error: msg, analysis_status: 'FAILED', ...extra }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}