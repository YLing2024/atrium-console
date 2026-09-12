import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../api.js';

/**
 * 服务器终端（多窗口 / 类似浏览器标签页）
 *
 * 每个标签 = 一个独立的 shell 会话：
 *   - 前端为每个标签挂一个 iframe（src=/term/?token=…&arg=<会话名>）
 *   - ttyd 的 --url-arg 把会话名传给服务端 wrapper，wrapper 用 tmux 的
 *     `new-session -A -s <名字>` 接上已有会话或新建
 *   - 标签在服务端是命名 tmux 会话：关掉浏览器再回来仍能接上（空闲 24h 回收）
 *   - 非激活标签只隐藏不卸载 → 连接保持，切回来立刻可用
 *
 * 认证沿用本域 SSO（nginx /term/ 的 auth_request 探针），token 走 query。
 */

const STORE_KEY = 'admin_term_tabs';

function loadTabs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    if (Array.isArray(raw)) return raw.filter((t) => t && t.id);
  } catch (e) {
    /* 忽略损坏的本地记录 */
  }
  return [];
}

function saveTabs(tabs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(tabs));
  } catch (e) {
    /* 存储不可用则仅内存态 */
  }
}

function newId() {
  return 'term-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function nextTitle(tabs) {
  const used = tabs
    .map((t) => {
      const m = /^终端\s*(\d+)$/.exec(t.title || '');
      return m ? Number(m[1]) : 0;
    })
    .filter(Boolean);
  return '终端 ' + ((used.length ? Math.max(...used) : 0) + 1);
}

export default function Terminal({ active }) {
  const [tabs, setTabs] = useState(() => loadTabs());
  const [current, setCurrent] = useState(() => (loadTabs()[0] || {}).id || null);
  const [alive, setAlive] = useState(() => new Set());
  const [nonce, setNonce] = useState(0); // 单个标签「重连」用
  const inited = useRef(false);

  // 首次启用且无标签时，自动开一个
  useEffect(() => {
    if (!active || inited.current) return;
    inited.current = true;
    if (!tabs.length) {
      const t = { id: newId(), title: '终端 1' };
      setTabs([t]);
      setCurrent(t.id);
    }
  }, [active, tabs.length]);

  useEffect(() => {
    saveTabs(tabs);
  }, [tabs]);

  // 会话存活状态（服务端 tmux 实时列表）
  const refreshAlive = useCallback(async () => {
    try {
      const token = getToken();
      const r = await fetch('/api/admin/term/sessions', {
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      });
      if (!r.ok) return;
      const d = await r.json();
      setAlive(new Set((d.sessions || []).map((s) => s.name)));
    } catch (e) {
      /* 网络波动忽略 */
    }
  }, []);

  useEffect(() => {
    if (!active || !tabs.length) return;
    refreshAlive();
    const t = setInterval(refreshAlive, 20000);
    return () => clearInterval(t);
  }, [active, tabs.length, refreshAlive]);

  function addTab() {
    const t = { id: newId(), title: nextTitle(tabs) };
    setTabs((prev) => [...prev, t]);
    setCurrent(t.id);
  }

  async function closeTab(id) {
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (current === id) setCurrent(rest.length ? rest[rest.length - 1].id : null);
    try {
      const token = getToken();
      await fetch('/api/admin/term/sessions/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      });
    } catch (e) {
      /* 失败也无所谓：空闲 24h 会被回收 */
    }
  }

  if (!active && !tabs.length) return null;

  const token = getToken() || '';

  return (
    <div className="term">
      <div className="term-tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={'term-tab' + (t.id === current ? ' active' : '')}
            onClick={() => setCurrent(t.id)}
            title={alive.has(t.id) ? '会话运行中' : '会话已结束'}
          >
            <span className={'term-dot' + (alive.has(t.id) ? '' : ' off')} />
            <span className="term-tab-title">{t.title}</span>
            <button
              type="button"
              className="term-x"
              title="关闭并结束该会话"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="term-add" onClick={addTab} title="新建终端">
          ＋
        </button>
        <button
          type="button"
          className="term-reconnect"
          onClick={() => {
            setNonce((n) => n + 1);
            refreshAlive();
          }}
          title="重连当前终端"
        >
          重连
        </button>
      </div>

      <div className="term-body">
        {tabs.map((t) => (
          <iframe
            key={t.id + ':' + nonce}
            className="term-frame"
            style={{ display: t.id === current ? 'block' : 'none' }}
            title={t.title}
            src={'/term/?token=' + encodeURIComponent(token) + '&arg=' + encodeURIComponent(t.id)}
          />
        ))}
      </div>
    </div>
  );
}
