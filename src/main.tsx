import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initTheme } from './theme';
import { initPwa } from './pwa';
import './fonts/fonts.css';
import './styles.css';

initTheme(); // 应用 localStorage 记忆的主题（亮/暗），避免刷新闪回
initPwa(); // 生产环境注册 Service Worker；开发态注销，避免缓存干扰
createRoot(document.getElementById('root')!).render(<App />);
