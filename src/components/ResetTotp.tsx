import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Space, Typography } from 'antd';
import QRCode from 'qrcode';
import { totpReset, totpResetConfirm } from '../api';

// 标准 TOTP 重置流程（两阶段）：
//  弹窗1 二次确认 → 调 reset 生成 pending → 弹窗2 显示 otpauth URI + 输入新验证码 → confirm 转正。
//  reset 后不 confirm 的 pending 5 分钟自动过期，不影响当前登录态。
export default function ResetTotp({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState('confirm'); // 'confirm' → 'uri'
  const [loading, setLoading] = useState(false);
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (step === 'uri' && uri && qrRef.current) {
      QRCode.toCanvas(qrRef.current, uri, { width: 180, margin: 1 }, (err) => {
        if (err) setError('二维码生成失败');
      });
    }
  }, [step, uri]);

  async function startReset() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await totpReset();
      setUri(data.otpauthUri || '');
      setStep('uri');
    } catch (err) {
      setError((err as Error).message || '重置失败');
    } finally {
      setLoading(false);
    }
  }

  async function copyUri() {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败，请手动复制 URI');
    }
  }

  async function submit() {
    if (loading) return;
    const value = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(value)) {
      setError('请输入 6 位数字验证码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await totpResetConfirm(value);
      setMessage('验证器已重置');
      setTimeout(() => onClose(), 900);
    } catch {
      setError('验证码错误，请重试');
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      title={step === 'uri' ? '重置验证器 · 绑定新验证码' : '重置验证器'}
      onCancel={() => !loading && onClose()}
      maskClosable={!loading}
      keyboard={!loading}
      footer={null}
      destroyOnHidden
    >
      {step === 'uri' ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12, lineHeight: 1.6 }}>
            在身份验证器中添加下方条目，然后输入 App 生成的新验证码完成确认。
          </Typography.Paragraph>
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
          <Typography.Text code style={{ wordBreak: 'break-all' }}>
            {uri || '（未获取到 otpauth URI）'}
          </Typography.Text>
          <Button onClick={copyUri} disabled={loading || !uri} style={{ alignSelf: 'flex-start' }}>
            {copied ? '已复制' : '复制 URI'}
          </Button>
          <Form onFinish={submit}>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              placeholder="输入 App 新验证码"
              autoFocus
              onChange={(e) => setCode(e.target.value)}
            />
            {message && <Alert type="success" showIcon message={message} style={{ marginTop: 12 }} />}
            {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} />}
            <Space style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <Button onClick={() => onClose()} disabled={loading}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" disabled={loading}>
                {loading ? '提交中…' : '提交'}
              </Button>
            </Space>
          </Form>
        </Space>
      ) : (
        <>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
            确定重置验证器？当前验证码将立即失效
          </Typography.Paragraph>
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
          <Space style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <Button onClick={() => onClose()} disabled={loading}>
              取消
            </Button>
            <Button type="primary" onClick={startReset} disabled={loading}>
              {loading ? '重置中…' : '确认重置'}
            </Button>
          </Space>
        </>
      )}
    </Modal>
  );
}
