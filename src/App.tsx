import { useEffect, useState } from 'react';
import { getMe, getAuthMode, setUnauthorizedHandler } from './api';
import Main from './components/Main';
import LoginPage from './components/LoginPage';

// 按认证模式分流：
//   sso     —— getMe 走网关 /_auth/me；401 由 api.js 整页跳 /_auth/login，本组件只等结果。
//   builtin —— getMe 走 /api/admin/me；未登录（401 → null）显示本地登录页，登录后进入应用。
export default function App() {
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'login'

  useEffect(() => {
    let alive = true;
    // builtin 模式会话失效：回到本地登录页（api.js 不会跳 /_auth/*）
    setUnauthorizedHandler(() => {
      if (alive) setState('login');
    });

    (async () => {
      const mode = await getAuthMode();
      try {
        const me = await getMe();
        if (!alive) return;
        if (me) setState('ready');
        else if (mode === 'builtin') setState('login');
        // sso 模式未登录：getMe 内部已整页跳转
      } catch (e) {
        // 认证服务不可达：不渲染应用（避免对 401 循环跳转），等待用户刷新
      }
    })();

    return () => {
      alive = false;
      setUnauthorizedHandler(null);
    };
  }, []);

  if (state === 'ready') return <Main />;
  if (state === 'login') return <LoginPage onSuccess={() => setState('ready')} />;
  return null;
}
