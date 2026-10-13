import { useEffect, useState } from 'react';
import { Badge, Button, Drawer, Dropdown, Layout, Menu } from 'antd';
import type { MenuProps } from 'antd';
import {
  KeyOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  SunOutlined,
  UserOutlined
} from '@ant-design/icons';
import { logout } from '../api';
import { getTheme, effectiveTheme, toggleTheme } from '../theme';
import System from './System';
import Apps from './Apps';
import BlogAdmin from './BlogAdmin';
import VersionPanel from './VersionPanel';
import ResetTotp from './ResetTotp';
import CommandPalette from './CommandPalette';
import Manage from './Manage';
import Terminal from './Terminal';
import Files from './Files';
import NotificationCenter from './NotificationCenter';
import NotificationManage from './NotificationManage';
import Debug from './Debug';
import Hermes from './Hermes';

// 合法 Tab 集合；sessionStorage 里的历史残留（旧版 'browse' / 'chat'）一律回退到首个 Tab
const TABS = [
  'system',
  'apps',
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
const TAB_LABELS: Record<string, string> = {
  system: '系统',
  apps: '应用',
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

// 窄屏判定（< 900px）：此时侧栏改由右侧抽屉承载
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

const { Header, Sider, Content } = Layout;

export default function Main() {
  const [tab, setTab] = useState(() => {
    const saved = sessionStorage.getItem('admin_tab');
    return saved && TABS.includes(saved) ? saved : 'system';
  });
  const [showReset, setShowReset] = useState(false);
  const [theme, setTheme] = useState(() => effectiveTheme(getTheme()));
  const [cmdOpen, setCmdOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // 窄屏：右侧抽屉是否展开
  const [unread, setUnread] = useState(0); // 通知中心未读数（侧栏徽标）
  const [notifRefreshTick, setNotifRefreshTick] = useState(0); // 管理页操作后触发展示页刷新
  const narrow = useIsNarrow();

  function switchTab(t: string) {
    setTab(t);
    sessionStorage.setItem('admin_tab', t); // 会话级记忆：同标签页内刷新后停留在上次 Tab
    setNavOpen(false); // 窄屏选中条目后收起抽屉（仅 UI，不触碰面板挂载）
  }

  function handleResetClose() {
    setShowReset(false);
  }

  // 退出登录：按认证模式处理（builtin 调本地登出接口，sso 跳网关登出）
  function handleLogout() {
    logout();
  }

  // 主题切换：applyTheme 改 CSS 变量并写入 localStorage，state 用于用户菜单图标
  function handleToggleTheme() {
    setTheme(toggleTheme());
  }

  // 全局 Ctrl+K 弹出命令面板（含 metaKey 兼容 macOS）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navItems: MenuProps['items'] = TABS.map((id) => ({
    key: id,
    label:
      id === 'notifications' ? (
        <span className="nav-item-label">
          {TAB_LABELS[id]}
          {unread > 0 && <Badge count={unread} overflowCount={99} />}
        </span>
      ) : (
        TAB_LABELS[id]
      )
  }));

  const userItems: MenuProps['items'] = [
    {
      key: 'theme',
      icon: theme === 'dark' ? <SunOutlined /> : <MoonOutlined />,
      label: theme === 'dark' ? '浅色主题' : '深色主题'
    },
    { key: 'reset', icon: <KeyOutlined />, label: '重置验证器' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true }
  ];

  function onUserMenuClick({ key }: { key: string }) {
    if (key === 'theme') handleToggleTheme();
    else if (key === 'reset') setShowReset(true);
    else if (key === 'logout') handleLogout();
  }

  const navMenu = (
    <Menu
      mode="inline"
      className="sidenav-menu"
      selectedKeys={[tab]}
      items={navItems}
      onClick={({ key }) => switchTab(key)}
      style={{ borderInlineEnd: 0 }}
    />
  );

  return (
    <Layout hasSider={!narrow} className="app">
      {/* 导航：桌面为左侧常驻侧栏；窄屏不渲染 Sider，改由右侧抽屉承载（不隐藏导航） */}
      {narrow ? (
        <Drawer
          placement="right"
          open={navOpen}
          onClose={() => setNavOpen(false)}
          width={260}
          className="sidenav-drawer"
          title={
            <span className="brand">
              <span className="dot" />
              Admin
            </span>
          }
        >
          {navMenu}
        </Drawer>
      ) : (
        <Sider width={200} theme="light" className="sidenav">
          <div className="brand sidenav-brand">
            <span className="dot" />
            Admin
          </div>
          {navMenu}
        </Sider>
      )}

      <Layout className="main-col">
        <Header className="topbar">
          {narrow && (
            <Button
              type="text"
              className="nav-toggle"
              icon={<MenuOutlined />}
              onClick={() => setNavOpen(true)}
            >
              目录
            </Button>
          )}
          <Dropdown
            menu={{ items: userItems, onClick: onUserMenuClick }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button type="text" className="user-entry" icon={<UserOutlined />}>
              Admin
            </Button>
          </Dropdown>
        </Header>

        <Content className="content">
          {/* 面板常驻挂载，仅切换显隐：避免切 tab 时浏览状态/内容丢失 */}
          <div className="pane" hidden={tab !== 'system'}>
            <System active={tab === 'system'} />
          </div>
          <div className="pane" hidden={tab !== 'apps'}>
            <Apps active={tab === 'apps'} />
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
        </Content>
      </Layout>

      {showReset && <ResetTotp onClose={handleResetClose} />}
      {cmdOpen && (
        <CommandPalette
          onClose={() => setCmdOpen(false)}
          onSwitchTab={switchTab}
          onShowReset={() => setShowReset(true)}
          onLogout={handleLogout}
        />
      )}
    </Layout>
  );
}
