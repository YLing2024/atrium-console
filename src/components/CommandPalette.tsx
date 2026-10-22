import { useEffect, useMemo, useRef, useState } from 'react';
import { Input, List, Modal } from 'antd';
import { navigate } from '../router';

/**
 * Ctrl+K 命令面板：全局命令列表。
 * ↑↓ 选择 / Enter 执行 / Esc 关闭；antd Modal + Input + List。
 */
export default function CommandPalette({
  onClose,
  onSwitchTab,
  onShowReset,
  onLogout
}: {
  onClose: () => void;
  onSwitchTab: (tab: string) => void;
  onShowReset: () => void;
  onLogout: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  // 通过 ref 读取最新 props，命令列表可稳定 useMemo，避免 keydown 监听反复重建
  const propsRef = useRef({ onClose, onSwitchTab, onShowReset, onLogout });
  propsRef.current = { onClose, onSwitchTab, onShowReset, onLogout };

  const items = useMemo(
    () => [
      { id: 'system', label: '跳到系统页', hint: '打开系统监控', run: () => propsRef.current.onSwitchTab('system') },
      { id: 'sites', label: '跳到站点页', hint: '查看站点 / 证书 / 备份', run: () => propsRef.current.onSwitchTab('sites') },
      { id: 'blog', label: '跳到博客页', hint: '管理博客文章', run: () => propsRef.current.onSwitchTab('blog') },
      { id: 'manage', label: '跳到管理页', hint: '管理已登录设备', run: () => propsRef.current.onSwitchTab('manage') },
      { id: 'terminal', label: '打开终端', hint: '服务器 Web 终端', run: () => propsRef.current.onSwitchTab('terminal') },
      { id: 'db', label: '打开数据库', hint: '云 MySQL 管理与查询', run: () => propsRef.current.onSwitchTab('db') },
      { id: 'tools', label: '打开工具', hint: 'Bitwarden 解锁等小工具', run: () => navigate('/tools') },
      { id: 'pwd', label: '重置验证器', hint: '更换 TOTP 验证器', run: () => propsRef.current.onShowReset() },
      { id: 'logout', label: '退出登录', hint: '安全退出', run: () => propsRef.current.onLogout() }
    ],
    []
  );

  // 关键字过滤（空串即全部）；选中项回到首条
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) => it.label.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  function runItem(item: { run: () => void }): void {
    propsRef.current.onClose();
    setTimeout(() => item.run(), 0); // 先关面板再执行，避免命令内弹窗与面板键盘监听冲突
  }

  function run(i: number): void {
    const item = visible[i];
    if (item) runItem(item);
  }

  // 接管键盘：↑↓ 选择 / Enter 执行 / Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        propsRef.current.onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => (visible.length ? (i + 1) % visible.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => (visible.length ? (i - 1 + visible.length) % visible.length : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        run(index);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, visible]);

  // 选中项滚入可视区（列表过长时）
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const active = el.querySelector('.cmd-item.selected');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return (
    <Modal
      open
      title={null}
      footer={null}
      closable={false}
      onCancel={() => propsRef.current.onClose()}
      className="cmd-palette"
      width={440}
      style={{ top: 96 }}
      styles={{ body: { padding: 14 } }}
    >
      <div className="cmd-head">
        <span className="cmd-title">命令面板</span>
        <span className="cmd-kbd">Ctrl + K</span>
      </div>
      <Input
        autoFocus
        allowClear
        value={query}
        placeholder="输入命令"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div ref={listRef}>
        <List
          className="cmd-list"
          dataSource={visible}
          locale={{ emptyText: '没有匹配的命令' }}
          renderItem={(item, i) => (
            <List.Item
              className={'cmd-item' + (i === index ? ' selected' : '')}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runItem(item)}
            >
              <span className="cmd-label">{item.label}</span>
              <span className="cmd-hint">{item.hint}</span>
            </List.Item>
          )}
        />
      </div>
      <div className="cmd-foot muted">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
    </Modal>
  );
}
