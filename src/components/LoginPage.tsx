import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Layout, Typography, theme } from 'antd';
import QRCode from 'qrcode';
import { login, totpSetup } from '../api';
import type { ApiError } from '../api';

// 自带账号（builtin）登录页：唯一输入是 TOTP 动态码（6 位数字）。
// 仅在未登录且后端 auth-mode 为 builtin 时渲染；sso 模式不会走到这里。
// 首次使用（后端回 code:'totp_setup_required'）就地引导绑定验证器，
// 二维码用 qrcode 绘制；密钥与提示一律 antd 默认样式（不写自定义配色/字距）。
export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const { token } = theme.useToken();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryLeft, setRetryLeft] = useState(0); // 429 限速剩余秒数（倒计时）
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null); // 首次设置：{ secret, otpauthUri }
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

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
      setError((err as Error).message || '获取绑定信息失败');
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

  async function submit() {
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
      const e = err as ApiError;
      if (e.code === 'totp_setup_required') {
        // 首次使用：先绑定验证器，再回来输入动态码
        setError('首次使用：请设置 TOTP');
        setLoading(false);
        await startSetup();
        return;
      }
      if (e.code === 'rate_limited' || e.status === 429) {
        const n = Math.max(1, Number(e.retryAfter) || 0);
        setRetryLeft(n);
        setError('');
      } else {
        setError(e.message || '验证码错误');
      }
      setLoading(false);
    }
  }

  return (
    <Layout className="login-wrap">
      <Form className="login-card" onFinish={submit}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Admin
        </Typography.Title>
        <Typography.Text type="secondary">管理后台 · 请输入动态验证码</Typography.Text>

        {setup && (
          <div className="totp-setup">
            <Typography.Text>首次使用：请设置 TOTP</Typography.Text>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <canvas
                ref={qrRef}
                style={{
                  width: 180,
                  height: 180,
                  padding: 10,
                  background: token.colorWhite
                }}
              />
            </div>
            <Button block title="点击复制密钥" onClick={copySecret}>
              <Typography.Text code style={{ wordBreak: 'break-all' }}>
                {setup.secret || '（未获取到密钥）'}
              </Typography.Text>
            </Button>
            <Typography.Text type="secondary">
              {copied ? '已复制' : '点击密钥复制'}
            </Typography.Text>
          </div>
        )}

        <Input
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
          <Alert type="error" message={`尝试过多，请 ${retryLeft} 秒后再试`} />
        ) : (
          error && <Alert type="error" message={error} />
        )}

        <Button
          type="primary"
          htmlType="submit"
          disabled={loading || retryLeft > 0 || !code.trim()}
        >
          {loading ? '登录中…' : retryLeft > 0 ? `请等待 ${retryLeft}s` : '登录'}
        </Button>
      </Form>
    </Layout>
  );
}
