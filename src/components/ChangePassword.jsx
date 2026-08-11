import { useEffect, useRef, useState } from 'react';
import { changePassword, clearToken } from '../api.js';

export default function ChangePassword({ onClose }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const timerRef = useRef(null);

  // 卸载时清理成功后的跳转定时器，避免组件已卸载仍触发 onClose
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  function validate() {
    if (!oldPassword || !newPassword || !confirm) return '请填写所有字段';
    if (newPassword.length < 6) return '新密码至少 6 位';
    if (newPassword !== confirm) return '两次输入的新密码不一致';
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    if (loading) return;
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setLoading(true);
    setError('');
    try {
      await changePassword(oldPassword, newPassword);
      clearToken(); // 服务端已注销所有会话，先清本地 token 防止期间继续请求
      setError('');
      setMessage('密码已修改，请重新登录');
      // 展示提示后通知 Main 关闭弹窗并跳转登录页（重定向统一由 Main 处理）
      timerRef.current = setTimeout(() => onClose(true), 900);
    } catch (err) {
      setError(err.message || '修改失败');
      setLoading(false);
    }
  }

  return (
    <div className="modal-mask" onClick={() => !loading && onClose()}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="modal-title">修改密码</h3>
        <input
          className="input"
          type="password"
          value={oldPassword}
          placeholder="旧密码"
          autoFocus
          autoComplete="current-password"
          onChange={(e) => setOldPassword(e.target.value)}
        />
        <input
          className="input"
          type="password"
          value={newPassword}
          placeholder="新密码（至少 6 位）"
          autoComplete="new-password"
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <input
          className="input"
          type="password"
          value={confirm}
          placeholder="确认新密码"
          autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)}
        />
        {message && <div className="success">{message}</div>}
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="btn-ghost" type="button" onClick={() => onClose()} disabled={loading}>
            取消
          </button>
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}
