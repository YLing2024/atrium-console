import { useState } from 'react';

/**
 * Hermes 面板：用 iframe 嵌入 Hermes 控制台。
 * - 地址来自构建期注入的 VITE_HERMES_DASHBOARD_URL，空值回退占位 https://hermes.example.com
 *   （真实域名只写在本地 .env，绝不入库）。
 * - 页内工具条：新窗口打开 / 刷新（重置 iframe src）；窄屏提示建议新窗口打开。
 * - 不做账号打通：Hermes 有自己的登录，iframe 内登一次即可。
 */

const HERMES_URL =
  (import.meta.env.VITE_HERMES_DASHBOARD_URL || '').trim() || 'https://hermes.example.com';

export default function Hermes() {
  const [reloadKey, setReloadKey] = useState(0);

  function openNewWindow() {
    window.open(HERMES_URL, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="hermes">
      <div className="hermes-bar">
        <h2>Hermes</h2>
        <span className="hermes-hint muted">窄屏下建议新窗口打开</span>
        <div className="hermes-actions">
          <button type="button" className="btn-ghost" onClick={openNewWindow}>
            新窗口打开
          </button>
          <button type="button" className="btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
            刷新
          </button>
        </div>
      </div>
      <div className="hermes-frame">
        <iframe
          key={reloadKey}
          src={HERMES_URL}
          title="Hermes 控制台"
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
