import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../api.js';

/**
 * 服务器终端（多窗口 / 类似浏览器标签页）
 *
 * 每个标签 = 一个独立 shell 会话：
 *   - 前端为每个标签挂一个 iframe（src=/term/?token=…&arg=<会话名>）
 *   - ttyd 的 --url-arg 把会话名传给服务端 wrapper，wrapper 用 tmux 的
 *     `new-session -A -s <名字>` 接上已有会话或新建
 *   - 刷新页面：同名接回（滚动历史保留）
 *   - **关闭窗口/离开页面：sendBeacon 批量杀掉本页创建的会话**，不留连接与进程；
 *     极端情况（浏览器被强杀）由服务端 webterm-reap.timer 15 分钟兜底
 *
 * 认证沿用本域 SSO（nginx /term/ 的 auth_request 探针），token 走 query。
 */

const STORE_KEY = 'admin_term_tabs';
const POLL_MS = 6000; // 存活状态轮询：够快，且只是一次本地小请求

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

// 是否「刷新」而不是「离开页面」：刷新时保留会话（用于接回），离开时清掉
function isReload() {
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    return nav ? nav.type === 'reload' : false;
  } catch (e) {
    return false;
  }
}

export default function Terminal({ active }) {
  const [tabs, setTabs] = useState(() => loadTabs());
  const [current, setCurrent] = useState(() => (loadTabs()[0] || {}).id || null);
  const [alive, setAlive] = useState(() => new Set());
  const [nonce, setNonce] = useState(0); // 「重连」用
  const inited = useRef(false);
  const tabsRef = useRef(tabs);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

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
    refreshAlive(); // 进入终端立刻校正一次
    const t = setInterval(refreshAlive, POLL_MS);
    return () => clearInterval(t);
  }, [active, tabs.length, refreshAlive]);

  // 离开页面（非刷新）：批量杀掉本页的会话，避免连接/进程残留
  useEffect(() => {
    let fired = false;
    function onLeave() {
      if (fired) return; // pagehide 与 beforeunload 会先后触发，只处理一次
      fired = true;
      if (isReload()) return; // 刷新保留，靠名字接回
      const names = tabsRef.current.map((t) => t.id);
      if (!names.length) return;
      try {
        const token = getToken() || '';
        const payload = new Blob([JSON.stringify({ names })], { type: 'application/json' });
        // 注意：sendBeacon 无法带自定义头（token 存在 localStorage），
        // 所以把 token 挂 query —— nginx 探针与 admin-server 都认 ?token=
        navigator.sendBeacon(
          '/api/admin/term/sessions/close?token=' + encodeURIComponent(token),
          payload
        );
      } catch (e) {
        /* 失败则由服务端 reaper 兜底 */
      }
    }
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, []);

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
      /* 失败也无所谓：reaper 会兜底 */
    } finally {
      refreshAlive();
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
            onLoad={() => {
              // 终端页面加载完 → 会话随即建立，立即校正一次状态（否则要点上十几秒才变绿）
              setTimeout(refreshAlive, 800);
            }}
          />
        ))}
      </div>
    </div>
  );
}
