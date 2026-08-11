import { useState } from 'react';
import { login, setToken } from '../api.js';

export default function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await login(password);
      setToken(data.token);
      onLogin();
    } catch (err) {
      setError(err.message || '登录失败');
    }
    setLoading(false);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">Admin</div>
        <p className="login-sub">管理后台 · 请输入访问密码</p>
        <input
          className="input"
          type="password"
          value={password}
          placeholder="密码"
          autoFocus
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button className="btn-primary" disabled={loading || !password} type="submit">
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
