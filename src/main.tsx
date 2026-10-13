import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { initTheme, getTheme, effectiveTheme, subscribeTheme, type Theme } from './theme';
import { buildAntdTheme } from './antdTheme';
import { initPwa } from './pwa';
import './fonts/fonts.css';
import './styles.css';

initTheme(); // 应用 localStorage 记忆的主题（亮/暗），避免刷新闪回
initPwa(); // 生产环境注册 Service Worker；开发态注销，避免缓存干扰

// 后台入口根：ConfigProvider 承载 antd 主题与中文文案，深浅色跟随 theme.ts。
// antd 的 message/notification 统一由外层 App 上下文提供（业务不再自绘 toast）。
function Root() {
  const [mode, setMode] = useState<Theme>(() => effectiveTheme(getTheme()));

  useEffect(() => subscribeTheme(setMode), []);

  return (
    <ConfigProvider locale={zhCN} theme={buildAntdTheme(mode)}>
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
