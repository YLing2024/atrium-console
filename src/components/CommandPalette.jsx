import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Ctrl+K 命令面板：全局命令列表。
 * ↑↓ 选择 / Enter 执行 / Esc 关闭，样式与现有 modal 一致。
 */
export default function CommandPalette({ onClose, onSwitchTab, onShowReset, onLogout }) {
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);

  // 通过 ref 读取最新 props，命令列表可稳定 useMemo，避免 keydown 监听反复重建
  const propsRef = useRef({ onClose, onSwitchTab, onShowReset, onLogout });
  propsRef.current = { onClose, onSwitchTab, onShowReset, onLogout };

  const items = useMemo(
    () => [
      { id: 'system', label: '跳到系统页', hint: '打开系统监控', run: () => propsRef.current.onSwitchTab('system') },
      { id: 'version', label: '跳到版本页', hint: '查看软件版本', run: () => propsRef.current.onSwitchTab('version') },
      { id: 'blog', label: '跳到博客页', hint: '管理博客文章', run: () => propsRef.current.onSwitchTab('blog') },
      { id: 'manage', label: '跳到管理页', hint: '管理已登录设备', run: () => propsRef.current.onSwitchTab('manage') },
      { id: 'terminal', label: '打开终端', hint: '服务器 Web 终端', run: () => propsRef.current.onSwitchTab('terminal') },
      { id: 'files', label: '打开文件', hint: '上传 / 下载文件', run: () => propsRef.current.onSwitchTab('files') },
      { id: 'pwd', label: '重置验证器', hint: '更换 TOTP 验证器', run: () => propsRef.current.onShowReset() },
      { id: 'logout', label: '退出登录', hint: '安全退出', run: () => propsRef.current.onLogout() }
    ],
    []
  );

  function run(i) {
    const item = items[i];
    if (!item) return;
    propsRef.current.onClose();
    setTimeout(() => item.run(), 0); // 先关面板再执行，避免命令内弹窗与面板键盘监听冲突
  }

  // 打开时重置选中项，并接管键盘：↑↓ 选择 / Enter 执行 / Esc 关闭
  useEffect(() => {
    setIndex(0);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        propsRef.current.onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        run(index);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // 选中项滚入可视区（列表过长时）
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const active = el.querySelector('.cmd-item.selected');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return (
    <div className="modal-mask cmd-mask" onClick={() => propsRef.current.onClose()}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-head">
          <span className="cmd-title">命令面板</span>
          <span className="cmd-kbd">Ctrl + K</span>
        </div>
        <ul className="cmd-list" ref={listRef}>
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                className={'cmd-item' + (i === index ? ' selected' : '')}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(i)}
              >
                <span className="cmd-label">{item.label}</span>
                <span className="cmd-hint">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="cmd-foot muted">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
      </div>
    </div>
  );
}
