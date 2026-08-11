import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initTheme } from './theme.js';
import './styles.css';

initTheme(); // 应用 localStorage 记忆的主题（亮/暗），避免刷新闪回
createRoot(document.getElementById('root')).render(<App />);
