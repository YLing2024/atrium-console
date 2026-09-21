import { useState } from 'react';
import NotificationDebug from './NotificationDebug.jsx';

/**
 * 调试页：工具容器。左侧工具列表 + 右侧工具面板。
 * 当前只有一项工具「通知调试」，其余留空（不造占位工具）。
 */

const TOOLS = [{ id: 'notifications', label: '通知调试' }];

export default function Debug() {
  const [tool, setTool] = useState('notifications');

  return (
    <div className="debug">
      <div className="debug-head">
        <h2>调试</h2>
      </div>
      <div className="debug-body">
        <nav className="debug-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={'debug-tool' + (tool === t.id ? ' active' : '')}
              onClick={() => setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="debug-panel">
          {tool === 'notifications' && <NotificationDebug />}
        </div>
      </div>
    </div>
  );
}
