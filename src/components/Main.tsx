import { useEffect, useState } from 'react';
import { Button, Drawer, Dropdown, Layout, Menu, Segmented } from 'antd';
import type { MenuProps } from 'antd';
import { KeyOutlined, LogoutOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { logout } from '../api';
import { navigate, readRoute, routePath, subscribe, type Route } from '../router';
import { getTheme, setThemePref, type ThemePref } from '../theme';
import System from './System';
import Logs from '../pages/Logs';
import BlogAdmin from './BlogAdmin';
import ResetTotp from './ResetTotp';
import CommandPalette from './CommandPalette';
import Manage from './Manage';
import SshKeys from './SshKeys';
import Terminal from './Terminal';
import Hermes from './Hermes';
import Database from './Database';
import Tools from './Tools';
import ToolBitwarden from '../pages/ToolBitwarden';

// 合法 Tab 集合；路径解析只会产出这些 id（旧版 sessionStorage 记忆已由 URL 取代）
const TABS = ['system', 'logs', 'blog', 'manage', 'sshkeys', 'terminal', 'hermes', 'db', 'tools'];
// 标签文字与顺序
const TAB_LABELS: Record<string, string> = {
  system: '系统',
  logs: '日志',
  blog: '博客',
  manage: '管理',
  sshkeys: 'SSH 公钥',
  terminal: '终端',
  hermes: 'Hermes',
  db: '数据库',
  tools: '工具'
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
  // Tab 完全由地址栏决定：首次读取会把 `/` 与未知路径归一，之后只靠 subscribe 同步。
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [showReset, setShowReset] = useState(false);
  const [pref, setPref] = useState<ThemePref>(() => getTheme()); // 三态：auto / light / dark
  const [cmdOpen, setCmdOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // 窄屏：右侧抽屉是否展开
  const narrow = useIsNarrow();
  const tab = route.section;

  // 主动跳转与浏览器前进 / 后退都只走这一条更新路径。
  useEffect(() => subscribe(() => setRoute(readRoute())), []);

  function switchTab(t: string) {
    navigate(routePath(t));
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
        <Header
          className="topbar"
          style={{
            // antd Layout.Header 默认深色底，浅色主题下会变成一条黑带；跟随主题容器色
            background: 'var(--ant-color-bg-container, #fff)',
            borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)'
          }}
        >
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
          <div className="pane" hidden={tab !== 'logs'}>
            <Logs />
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
          {/* 工具面板：导航列表常驻；解锁页只在 `/tools/<tool>` 时挂载，离开即卸载输入状态 */}
          <div className="pane pane--tools" hidden={tab !== 'tools'}>
            {route.tool ? <ToolBitwarden /> : <Tools active={tab === 'tools'} />}
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
