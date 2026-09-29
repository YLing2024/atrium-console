import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { login, totpSetup } from '../api.js';

// 自带账号（builtin）登录页：唯一输入是 TOTP 动态码（6 位数字）。
// 仅在未登录且后端 auth-mode 为 builtin 时渲染；sso 模式不会走到这里。
// 首次使用（后端回 code:'totp_setup_required'）就地引导绑定验证器，
// 二维码/密钥沿用既有 TOTP 设置样式（.totp-*），不另起一套。
export default function LoginPage({ onSuccess }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryLeft, setRetryLeft] = useState(0); // 429 限速剩余秒数（倒计时）
  const [setup, setSetup] = useState(null); // 首次设置：{ secret, otpauthUri }
  const [copied, setCopied] = useState(false);
  const qrRef = useRef(null);

  // 限速倒计时：每秒递减，归零后可再次提交
  useEffect(() => {
    if (retryLeft <= 0) return;
    const t = setTimeout(() => setRetryLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [retryLeft]);

  // 首次设置：把 otpauth URI 画成二维码（与「重置验证器」同款画法）
  useEffect(() => {
    if (setup && setup.otpauthUri && qrRef.current) {
      QRCode.toCanvas(qrRef.current, setup.otpauthUri, { width: 180, margin: 1 }, (err) => {
        if (err) setError('二维码生成失败');
      });
    }
  }, [setup]);

  // 拉取首次绑定信息（未配置 TOTP 时才可用）
  async function startSetup() {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const data = await totpSetup();
      setSetup({ secret: data.secret || '', otpauthUri: data.otpauthUri || '' });
      setCode('');
    } catch (err) {
      setError(err.message || '获取绑定信息失败');
    } finally {
      setLoading(false);
    }
  }

  async function copySecret() {
    if (!setup || !setup.secret) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError('复制失败，请手动抄写密钥');
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (loading || retryLeft > 0) return;
    const value = code.replace(/\s+/g, ''); // 自动 trim 空格
    if (!/^\d{6}$/.test(value)) {
      setError('请输入 6 位数字验证码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(value);
      onSuccess();
    } catch (err) {
      if (err.code === 'totp_setup_required') {
        // 首次使用：先绑定验证器，再回来输入动态码
        setError('首次使用：请设置 TOTP');
        setLoading(false);
        await startSetup();
        return;
      }
      if (err.code === 'rate_limited' || err.status === 429) {
        const n = Math.max(1, Number(err.retryAfter) || 0);
        setRetryLeft(n);
        setError('');
      } else {
        setError(err.message || '验证码错误');
      }
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">Admin</div>
        <p className="login-sub">管理后台 · 请输入动态验证码</p>

        {setup && (
          <div className="totp-setup">
            <label className="totp-label">首次使用：请设置 TOTP</label>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <canvas
                ref={qrRef}
                style={{
                  width: 180,
                  height: 180,
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: 10,
                  background: '#fff'
                }}
              />
            </div>
            <button
              className="totp-secret"
              type="button"
              onClick={copySecret}
              title="点击复制密钥"
            >
              {setup.secret || '（未获取到密钥）'}
            </button>
            <span className="totp-label">{copied ? '已复制' : '点击密钥复制'}</span>
          </div>
        )}

        <input
          className="input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          placeholder="6 位动态验证码"
          autoFocus
          autoComplete="one-time-code"
          onChange={(e) => setCode(e.target.value)}
        />

        {retryLeft > 0 ? (
          <div className="error">尝试过多，请 {retryLeft} 秒后再试</div>
        ) : (
          error && <div className="error">{error}</div>
        )}

        <button
          className="btn-primary"
          type="submit"
          disabled={loading || retryLeft > 0 || !code.trim()}
        >
          {loading ? '登录中…' : retryLeft > 0 ? `请等待 ${retryLeft}s` : '登录'}
        </button>
      </form>
    </div>
  );
}
