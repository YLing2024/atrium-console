import { useEffect, useRef, useState } from 'react';
import { logout } from '../api.js';
import { getTheme, effectiveTheme, toggleTheme } from '../theme.js';
import Browse from './Browse.jsx';
import System from './System.jsx';
import BlogAdmin from './BlogAdmin.jsx';
import VersionPanel from './VersionPanel.jsx';
import ResetTotp from './ResetTotp.jsx';
import CommandPalette from './CommandPalette.jsx';
import Manage from './Manage.jsx';

export default function Main() {
  // 旧版 Tab key 'chat'（聊天）兼容：按 'browse'（浏览）处理
  const [tab, setTab] = useState(() => {
    const saved = sessionStorage.getItem('admin_tab') || 'browse';
    return saved === 'chat' ? 'browse' : saved;
  });
  const [showReset, setShowReset] = useState(false);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState(() => effectiveTheme(getTheme()));
  const [cmdOpen, setCmdOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  function switchTab(t) {
    setTab(t);
    sessionStorage.setItem('admin_tab', t); // 会话级记忆：同标签页内刷新后停留在上次 Tab
  }

  function handleResetClose() {
    setShowReset(false);
  }

  // 退出登录：清除本地 token 并跳回认证中心
  function handleLogout() {
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
            className={'tab' + (tab === 'browse' ? ' active' : '')}
            onClick={() => switchTab('browse')}
          >
            浏览
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
        {/* 面板常驻挂载，仅切换显隐：避免切 tab 时浏览状态/内容丢失 */}
        <div className="pane" hidden={tab !== 'browse'}>
          <Browse active={tab === 'browse'} />
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
