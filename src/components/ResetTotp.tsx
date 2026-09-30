import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  const qrRef = useRef(null);

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
    } catch (e) {
      setError('复制失败，请手动复制 URI');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
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
    } catch (err) {
      setError('验证码错误，请重试');
      setLoading(false);
    }
  }

  // 弹窗2：展示 otpauth URI + 输入新验证码
  if (step === 'uri') {
    return (
      <div className="modal-mask" onClick={() => !loading && onClose()}>
        <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
          <h3 className="modal-title">重置验证器 · 绑定新验证码</h3>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            在身份验证器中添加下方条目，然后输入 App 生成的新验证码完成确认。
          </p>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 8
            }}
          >
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
          <code
            className="muted"
            style={{
              display: 'block',
              wordBreak: 'break-all',
              fontSize: 11,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              padding: 8,
              marginBottom: 4
            }}
          >
            {uri || '（未获取到 otpauth URI）'}
          </code>
          <button
            className="btn-ghost"
            type="button"
            onClick={copyUri}
            disabled={loading || !uri}
            style={{ alignSelf: 'flex-start' }}
          >
            {copied ? '已复制' : '复制 URI'}
          </button>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            placeholder="输入 App 新验证码"
            autoFocus
            onChange={(e) => setCode(e.target.value)}
          />
          {message && <div className="success">{message}</div>}
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button className="btn-ghost" type="button" onClick={() => onClose()} disabled={loading}>
              取消
            </button>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? '提交中…' : '提交'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // 弹窗1：二次确认
  return (
    <div className="modal-mask" onClick={() => !loading && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">重置验证器</h3>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          确定重置验证器？当前验证码将立即失效
        </p>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="btn-ghost" type="button" onClick={() => onClose()} disabled={loading}>
            取消
          </button>
          <button className="btn-primary" type="button" onClick={startReset} disabled={loading}>
            {loading ? '重置中…' : '确认重置'}
          </button>
        </div>
      </div>
    </div>
  );
}
