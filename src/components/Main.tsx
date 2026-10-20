import { useEffect, useState } from 'react';
import { Button, Drawer, Dropdown, Layout, Menu, Segmented } from 'antd';
import type { MenuProps } from 'antd';
import { KeyOutlined, LogoutOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { logout } from '../api';
import { getTheme, setThemePref, type ThemePref } from '../theme';
import System from './System';
import BlogAdmin from './BlogAdmin';
import ResetTotp from './ResetTotp';
import CommandPalette from './CommandPalette';
import Manage from './Manage';
import SshKeys from './SshKeys';
import Terminal from './Terminal';
import Hermes from './Hermes';
import Database from './Database';

// 合法 Tab 集合；sessionStorage 里的历史残留（旧版 'browse' / 'chat' / 已下线的通知页 / 应用 / 版本 /
// 文件 / 调试）一律回退到首个 Tab
const TABS = ['system', 'blog', 'manage', 'sshkeys', 'terminal', 'hermes', 'db'];
// 标签文字与顺序
const TAB_LABELS: Record<string, string> = {
  system: '系统',
  blog: '博客',
  manage: '管理',
  sshkeys: 'SSH 公钥',
  terminal: '终端',
  hermes: 'Hermes',
  db: '数据库'
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
  const [pref, setPref] = useState<ThemePref>(() => getTheme()); // 三态：auto / light / dark
  const [cmdOpen, setCmdOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // 窄屏：右侧抽屉是否展开
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

  // 主题三态：显式设置 auto / light / dark，立即生效并写入 localStorage。
  // 颜色由 antd ConfigProvider 按生效主题切换（main.tsx 订阅 theme.ts）。
  function handleThemeChange(value: string | number) {
    const next = value as ThemePref;
    setThemePref(next);
    setPref(next);
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

  // 侧栏导航项：Tab 一律用与 id 对应的中文标签。
  const navItems: MenuProps['items'] = TABS.map((id) => ({
    key: id,
    label: TAB_LABELS[id]
  }));

  const userItems: MenuProps['items'] = [
    { key: 'reset', icon: <KeyOutlined />, label: '重置验证器' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true }
  ];

  function onUserMenuClick({ key }: { key: string }) {
    if (key === 'reset') setShowReset(true);
    else if (key === 'logout') handleLogout();
  }

  // 主题三态切换器：宽屏内联顶栏，窄屏收进右侧抽屉（同一控件复用）。
  const themeSwitcher = (
    <Segmented
      className="theme-switch"
      value={pref}
      onChange={handleThemeChange}
      options={[
        { label: '自动', value: 'auto' },
        { label: '亮色', value: 'light' },
        { label: '暗色', value: 'dark' }
      ]}
    />
  );

  const navMenu = (
    <Menu
      mode="inline"
      selectedKeys={[tab]}
      items={navItems}
      onClick={({ key }) => switchTab(key)}
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
          title={<span className="brand">Admin</span>}
        >
          <div className="sidenav-theme">{themeSwitcher}</div>
          {navMenu}
        </Drawer>
      ) : (
        <Sider width={200} theme="light" className="sidenav">
          <div className="brand sidenav-brand">Admin</div>
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
          {!narrow && themeSwitcher}
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
          <div className="pane" hidden={tab !== 'blog'}>
            <BlogAdmin />
          </div>
          <div className="pane" hidden={tab !== 'manage'}>
            <Manage />
          </div>
          <div className="pane" hidden={tab !== 'sshkeys'}>
            <SshKeys />
          </div>
          <div className="pane pane--term" hidden={tab !== 'terminal'}>
            <Terminal active={tab === 'terminal'} />
          </div>
          <div className="pane pane--hermes" hidden={tab !== 'hermes'}>
            <Hermes />
          </div>
          <div className="pane pane--db" hidden={tab !== 'db'}>
            <Database active={tab === 'db'} />
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
