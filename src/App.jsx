import { useState, useEffect } from 'react';
import { getMe } from './api.js';
import Main from './components/Main.jsx';

// 启动时问网关照要身份：200 → 直接进入应用（不再显示自己的登录页）；
// 401 → getMe 内部已整页跳 /_auth/login?next=。
export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    getMe()
      .then((me) => {
        if (alive && me) setReady(true);
      })
      .catch(() => {
        // 网关不可达：不渲染应用（避免对 401 循环跳转），等待用户刷新
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return null;
  return <Main />;
}
