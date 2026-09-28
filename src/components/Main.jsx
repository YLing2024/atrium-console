import { useEffect, useRef, useState } from 'react';
import { logout } from '../api.js';
import { getTheme, effectiveTheme, toggleTheme } from '../theme.js';
import System from './System.jsx';
import BlogAdmin from './BlogAdmin.jsx';
import VersionPanel from './VersionPanel.jsx';
import ResetTotp from './ResetTotp.jsx';
import CommandPalette from './CommandPalette.jsx';
import Manage from './Manage.jsx';
import Terminal from './Terminal.jsx';
import Files from './Files.jsx';
import NotificationCenter from './NotificationCenter.jsx';
import NotificationManage from './NotificationManage.jsx';
import Debug from './Debug.jsx';
import Hermes from './Hermes.jsx';

// 合法 Tab 集合；sessionStorage 里的历史残留（旧版 'browse' / 'chat'）一律回退到首个 Tab
const TABS = [
  'system',
  'version',
  'blog',
  'manage',
  'terminal',
  'files',
  'notifications',
  'notification-manage',
  'debug',
  'hermes'
];
// 标签文字与顺序：原有六项相对顺序不变，其后依次追加「通知 / 通知管理 / 调试 / Hermes」
const TAB_LABELS = {
  system: '系统',
  version: '版本',
  blog: '博客',
  manage: '管理',
  terminal: '终端',
  files: '文件',
  notifications: '通知',
  'notification-manage': '通知管理',
  debug: '调试',
  hermes: 'Hermes'
};

export default function Main() {
  const [tab, setTab] = useState(() => {
    const saved = sessionStorage.getItem('admin_tab');
    return TABS.includes(saved) ? saved : 'system';
  });
  const [showReset, setShowReset] = useState(false);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState(() => effectiveTheme(getTheme()));
  const [cmdOpen, setCmdOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // 窄屏：右侧抽屉是否展开
  const [unread, setUnread] = useState(0); // 通知中心未读数（侧栏徽标）
  const [notifRefreshTick, setNotifRefreshTick] = useState(0); // 管理页操作后触发展示页刷新
  const menuRef = useRef(null);

  function switchTab(t) {
    setTab(t);
    sessionStorage.setItem('admin_tab', t); // 会话级记忆：同标签页内刷新后停留在上次 Tab
    setNavOpen(false); // 窄屏选中条目后收起抽屉（仅 UI，不触碰面板挂载）
  }

  function handleResetClose() {
    setShowReset(false);
  }

  // 退出登录：交给网关清站点会话
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

  // 窄屏抽屉：按 Esc 关闭
  useEffect(() => {
    if (!navOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') setNavOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

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
      {/* 窄屏抽屉遮罩：点击关闭；桌面端由 CSS 隐藏 */}
      {navOpen && <div className="sidenav-backdrop" onClick={() => setNavOpen(false)} />}

      {/* 导航：桌面为左侧固定侧栏（≥1024px），窄屏为右侧滑出抽屉 */}
      <aside className={'sidenav' + (navOpen ? ' open' : '')}>
        <div className="brand sidenav-brand">
          <span className="dot" />
          Admin
        </div>
        <nav className="sidenav-list">
          {TABS.map((id) => (
            <button
              key={id}
              className={'sidenav-item' + (tab === id ? ' active' : '')}
              onClick={() => switchTab(id)}
            >
              <span className="sidenav-item-label">{TAB_LABELS[id]}</span>
              {id === 'notifications' && unread > 0 && (
                <span className="sidenav-badge">{unread > 99 ? '99+' : unread}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button
            type="button"
            className="nav-toggle"
            onClick={() => setNavOpen(true)}
            title="菜单"
            aria-label="菜单"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <line x1="2" y1="5" x2="16" y2="5" />
              <line x1="2" y1="9" x2="16" y2="9" />
              <line x1="2" y1="13" x2="16" y2="13" />
            </svg>
          </button>
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
          <div className="pane" hidden={tab !== 'system'}>
            <System active={tab === 'system'} />
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
          <div className="pane pane--term" hidden={tab !== 'terminal'}>
            <Terminal active={tab === 'terminal'} />
          </div>
          <div className="pane" hidden={tab !== 'files'}>
            <Files active={tab === 'files'} />
          </div>
          <div className="pane" hidden={tab !== 'notifications'}>
            <NotificationCenter
              refreshTick={notifRefreshTick}
              onUnreadChange={setUnread}
              onOpen={() => switchTab('notifications')}
            />
          </div>
          <div className="pane" hidden={tab !== 'notification-manage'}>
            <NotificationManage
              active={tab === 'notification-manage'}
              onChanged={() => setNotifRefreshTick((t) => t + 1)}
            />
          </div>
          <div className="pane" hidden={tab !== 'debug'}>
            <Debug />
          </div>
          <div className="pane pane--hermes" hidden={tab !== 'hermes'}>
            <Hermes />
          </div>
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
