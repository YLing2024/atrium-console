import { useState, useEffect } from 'react';
import { getToken, setToken } from './api.js';
import Login from './components/Login.jsx';
import Main from './components/Main.jsx';

// 从 URL 提取认证中心回跳的 token：OAuth2 风格 query ?token=（fragment 保留兜底）
function tokenFromUrl() {
  const frag = /^#token=([^&]+)/.exec(location.hash);
  if (frag) return decodeURIComponent(frag[1]);
  return new URLSearchParams(location.search).get('token');
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = tokenFromUrl();
    if (!token) {
      setReady(true);
      return;
    }
    // 认证中心签发的 token 即后端信任的凭证（Nginx 探针据此鉴权）：
    // 直接存入 localStorage，不再调 sso/verify 换取本地会话
    setToken(token);
    // 立即清掉 URL 中的 token，避免留在地址栏/浏览器历史
    history.replaceState(null, '', location.pathname);
    setAuthed(true);
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!authed) return <Login />;
  return <Main />;
}
