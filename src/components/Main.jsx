import { useEffect, useRef, useState } from 'react';
import { logout } from '../api.js';
import { closeSocket } from '../ws.js';
import { getTheme, effectiveTheme, toggleTheme } from '../theme.js';
import Chat from './Chat.jsx';
import System from './System.jsx';
import BlogAdmin from './BlogAdmin.jsx';
import VersionPanel from './VersionPanel.jsx';
import ResetTotp from './ResetTotp.jsx';
import CommandPalette from './CommandPalette.jsx';
import Manage from './Manage.jsx';

export default function Main() {
  const [tab, setTab] = useState(() => localStorage.getItem('admin_tab') || 'chat');
  const [showReset, setShowReset] = useState(false);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState(() => effectiveTheme(getTheme()));
  const [cmdOpen, setCmdOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  function switchTab(t) {
    setTab(t);
    localStorage.setItem('admin_tab', t); // 持久化：刷新后停留在上次 Tab
  }

  function handleResetClose() {
    setShowReset(false);
  }

  // 退出登录：先主动关闭 WS（避免 token 已清后连接残留 / 误触发重连），再走 api 的 logout
  function handleLogout() {
    closeSocket();
    logout();
  }

  // 主题切换：applyTheme 改 CSS 变量并写入 localStorage，state 用于刷新按钮图标
  function handleToggleTheme() {
    setTheme(toggleTheme());
  }

  // 用户菜单：点击外部 / 按 Esc 关闭
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // 全局 Ctrl+K 弹出命令面板（含 metaKey 兼容 macOS）
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <nav className="tabs">
          <button
            className={'tab' + (tab === 'chat' ? ' active' : '')}
            onClick={() => switchTab('chat')}
          >
            聊天
          </button>
          <button
            className={'tab' + (tab === 'system' ? ' active' : '')}
            onClick={() => switchTab('system')}
          >
            系统
          </button>
          <button
            className={'tab' + (tab === 'version' ? ' active' : '')}
            onClick={() => switchTab('version')}
          >
            版本
          </button>
          <button
            className={'tab' + (tab === 'blog' ? ' active' : '')}
            onClick={() => switchTab('blog')}
          >
            博客
          </button>
          <button
            className={'tab' + (tab === 'manage' ? ' active' : '')}
            onClick={() => switchTab('manage')}
          >
            管理
          </button>
        </nav>
        <div className="user-menu" ref={menuRef}>
          <button
            className="user-menu-btn"
            onClick={() => setMenuOpen((o) => !o)}
            title="账户菜单"
            aria-label="账户菜单"
          >
            <span className="dot" />
            Admin
            <span className="caret">▾</span>
          </button>
          {menuOpen && (
            <div className="user-dropdown">
              <button
                className="dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  handleToggleTheme();
                }}
              >
                {theme === 'dark' ? '浅色主题' : '深色主题'}
              </button>
              <button
                className="dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  setShowReset(true);
                }}
              >
                重置验证器
              </button>
              <button
                className="dropdown-item danger"
                onClick={() => {
                  setMenuOpen(false);
                  handleLogout();
                }}
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="content">
        {/* 两个面板常驻挂载，仅切换显隐：避免切 tab 时 Chat 被卸载导致
            会话/流式回复/输入内容丢失、WS 重连闪烁等渲染问题 */}
        <div className="pane" hidden={tab !== 'chat'}>
          <Chat active={tab === 'chat'} />
        </div>
        <div className="pane" hidden={tab !== 'system'}>
          <System />
        </div>
        <div className="pane" hidden={tab !== 'version'}>
          <VersionPanel active={tab === 'version'} />
        </div>
        <div className="pane" hidden={tab !== 'blog'}>
          <BlogAdmin />
        </div>
        <div className="pane" hidden={tab !== 'manage'}>
          <Manage />
        </div>
      </div>

      {showReset && <ResetTotp onClose={handleResetClose} />}
      {cmdOpen && (
        <CommandPalette
          onClose={() => setCmdOpen(false)}
          onSwitchTab={switchTab}
          onShowReset={() => setShowReset(true)}
          onLogout={handleLogout}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
