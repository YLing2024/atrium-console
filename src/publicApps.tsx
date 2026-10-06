import React from 'react';
import { createRoot } from 'react-dom/client';
import PublicApps from './components/PublicApps';
import { initTheme } from './theme';
import './fonts/fonts.css';
import './styles.css';

// 公开「应用中心」入口：无鉴权、无登录页、无侧栏；只渲染 PublicApps。
initTheme(); // 应用 localStorage 记忆的主题（亮/暗），避免刷新闪回
createRoot(document.getElementById('root')!).render(<PublicApps />);
