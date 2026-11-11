// src/pages/Login.tsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { BRAND } from '../lib/theme';
import type { Theme } from '../lib/theme';

interface LoginProps { onClose?: () => void; theme?: Theme; }

// FIX 功能#2: 更严格的邮箱校验 — TLD必须≥2位真实字母，qq.co / gmail.co 等会被拦截
function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  // 基本格式：local@domain.tld
  const re = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
  if (!re.test(trimmed)) return false;
  const [, domain] = trimmed.split('@');
  const parts = domain.split('.');
  // 每段不为空，TLD ≥ 2 字符
  if (parts.some(p => p.length === 0)) return false;
  if (parts[parts.length - 1].length < 2) return false;
  return true;
}

export default function Login({ onClose, theme = 'dark' }: LoginProps) {
  const isDark = theme === 'dark';

  const [email, setEmail]               = useState('');
  const [code, setCode]                 = useState('');
  const [captcha, setCaptcha]           = useState('');
  const [captchaAns, setCaptchaAns]     = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [step, setStep]                 = useState<'email'|'code'>('email');
  const [loading, setLoading]           = useState(false);
  const [countdown, setCountdown]       = useState(0);
  const [error, setError]               = useState('');

  const genCaptcha = () => {
    const a = Math.floor(Math.random()*9)+1;
    const b = Math.floor(Math.random()*9)+1;
    setCaptcha(`${a} + ${b} = ?`);
    setCaptchaAns(String(a+b));
    setCaptchaInput('');
  };
  useEffect(() => { genCaptcha(); }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown(c => c-1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const handleSendCode = async () => {
    setError('');
    // FIX: 用严格校验替换原来宽松的正则
    if (!isValidEmail(email)) {
      setError('请输入正确的邮箱地址（如 example@qq.com）');
      return;
    }
    if (captchaInput !== captchaAns) { setError('验证码错误，请重新计算'); genCaptcha(); return; }
    setLoading(true);
    try {
      const { error: e } = await supabase.auth.signInWithOtp({ email: email.trim() });
      if (e) throw e;
      setStep('code');
      setCountdown(60);
    } catch (e: any) {
      setError(e.message ?? '发送失败，请稍后重试');
      genCaptcha();
    } finally { setLoading(false); }
  };

  const handleVerify = async () => {
    setError('');
    if (code.length < 4) { setError('请输入邮箱验证码'); return; }
    setLoading(true);
    try {
      const { error: e } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
      if (e) throw e;
    } catch (e: any) {
      setError(e.message ?? '验证失败，请检查验证码');
    } finally { setLoading(false); }
  };

  const border     = isDark ? '#383838' : '#E2E0D9';
  const textColor  = isDark ? '#EBEBEB' : '#1A1A1A';
  const subColor   = isDark ? '#9B9B9B' : '#6B6B6B';
  const mutedColor = isDark ? '#5A5A5A' : '#ACACAC';
  const inputBg    = isDark ? '#1A1A1A' : '#FAFAF8';
  const captchaBg  = isDark ? '#2A2A2A' : '#FFFFFF';

  const inputStyle: React.CSSProperties = {
    width:'100%', padding:'11px 14px',
    background: inputBg, border: `1px solid ${border}`,
    borderRadius:'8px', color: textColor, fontSize:'14px',
    outline:'none', boxSizing:'border-box',
    fontFamily:"'Inter', system-ui, sans-serif",
  };

  const btnStyle: React.CSSProperties = {
    width:'100%', padding:'12px',
    background: loading ? (isDark?'#5A5A5A':'#ACACAC') : BRAND.accent,
    border:'none', borderRadius:'8px',
    color:'#fff', fontSize:'14px', fontWeight:600,
    cursor: loading ? 'not-allowed' : 'pointer',
    transition:'background 0.15s',
    fontFamily:"'Inter', system-ui, sans-serif",
  };

  return (
    <div style={{ padding:'32px 28px 24px', color:textColor, fontFamily:"'Inter', system-ui, sans-serif", background:'transparent' }}>
      <div style={{ fontSize:'18px', fontWeight:700, marginBottom:'6px', color:textColor, textAlign:'center' }}>
        {step==='email' ? '登录 / 注册' : '输入验证码'}
      </div>
      <div style={{ fontSize:'13px', color:subColor, marginBottom:'24px', textAlign:'center' }}>
        {step==='email' ? '使用邮箱快速登录，登录后可解锁更多功能！' : `验证码已发送至 ${email.trim()}`}
      </div>

      {step === 'email' && (
        <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
          <input style={inputStyle} placeholder="请输入邮箱地址" type="email" value={email}
            onChange={e => { setEmail(e.target.value); setError(''); }}/>

          <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
            <div style={{ padding:'10px 14px', background:captchaBg, borderRadius:'8px', border:`1px solid ${border}`, color:textColor, fontSize:'14px', whiteSpace:'nowrap', flex:1, textAlign:'center', fontWeight:600 }}>
              {captcha}
            </div>
            <input style={{ ...inputStyle, flex:1 }} placeholder="计算结果" value={captchaInput}
              onChange={e => { setCaptchaInput(e.target.value); setError(''); }} maxLength={3}/>
            <button onClick={genCaptcha}
              style={{ padding:'10px 12px', background:captchaBg, border:`1px solid ${border}`, borderRadius:'8px', color:subColor, cursor:'pointer', fontSize:'13px', whiteSpace:'nowrap' }}>
              换一题
            </button>
          </div>

          {error && <div style={{ color:BRAND.danger, fontSize:'12px' }}>{error}</div>}
          <button onClick={handleSendCode} disabled={loading} style={btnStyle}>
            {loading ? '发送中...' : '获取验证码'}
          </button>
        </div>
      )}

      {step === 'code' && (
        <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
          <input style={inputStyle} placeholder="请输入6位验证码" value={code} maxLength={6}
            onChange={e => { setCode(e.target.value.replace(/\D/g,'')); setError(''); }}/>
          {error && <div style={{ color:BRAND.danger, fontSize:'12px' }}>{error}</div>}
          <button onClick={handleVerify} disabled={loading} style={btnStyle}>
            {loading ? '验证中...' : '登录'}
          </button>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <button onClick={() => { setStep('email'); setCode(''); setError(''); genCaptcha(); }}
              style={{ background:'none', border:'none', color:subColor, fontSize:'13px', cursor:'pointer', padding:0 }}>
              ← 重新输入邮箱地址
            </button>
            <button onClick={handleSendCode} disabled={countdown>0||loading}
              style={{ background:'none', border:'none', color:countdown>0?mutedColor:BRAND.accent, fontSize:'13px', cursor:countdown>0?'not-allowed':'pointer', padding:0 }}>
              {countdown>0 ? `${countdown}s 后重发` : '重新发送'}
            </button>
          </div>
        </div>
      )}

      {step==='email' && (
        <div style={{ marginTop:'20px', paddingTop:'16px', borderTop:`1px solid ${border}`, textAlign:'center' }}>
          <span style={{ fontSize:'12px', color:mutedColor }}>游客模式每日可解析 3 次，数据不保存 · </span>
          {onClose && (
            <span onClick={onClose} style={{ fontSize:'12px', color:BRAND.accent, cursor:'pointer' }}>暂不登录</span>
          )}
        </div>
      )}
    </div>
  );
}