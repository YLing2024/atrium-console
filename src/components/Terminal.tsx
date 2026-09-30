import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

/**
 * 服务器终端（多窗口 / 类似浏览器标签页）+ 二次验证
 *
 * 认证是两层：
 *   1. 本域登录（网关对 /term/ 鉴权，通过后放行）—— 与 admin 后台同一张通行证
 *   2. 终端口令 —— 通过 POST /api/admin/term/unlock 换一张 12 小时票据，
 *      票据随 iframe 一起传给服务端 wrapper，wrapper 起 shell 前向 admin-server 校验；
 *      票据无效/缺失就拒绝起 shell（ttyd 只监听 127.0.0.1，绕不过 wrapper）
 *
 * 每个标签 = 一个独立 shell 会话：
 *   - iframe src = /term/?arg=<会话名>&arg=<票据>（登录态由网关 cookie 证明）
 *   - ttyd --url-arg 把两个 arg 按顺序作为 $1/$2 传给 wrapper
 *   - wrapper 用 tmux `new-session -A -s <名字>` 接上已有会话或新建
 *   - 刷新页面：按名字接回（滚动历史保留）
 *   - 关闭窗口/离开页面：sendBeacon 批量杀掉本页会话，不留连接与进程
 */

const STORE_KEY = 'admin_term_tabs';
const TICKET_KEY = 'admin_term_ticket';
const POLL_MS = 6000;

/** 终端标签（id 即 tmux 会话名） */
interface TermTab {
  id: string;
  title: string;
}

function loadTabs(): TermTab[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    if (Array.isArray(raw)) return raw.filter((t) => t && t.id) as TermTab[];
  } catch (e) {
    /* 忽略损坏的本地记录 */
  }
  return [];
}

function saveTabs(tabs: TermTab[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(tabs));
  } catch (e) {
    /* 存储不可用则仅内存态 */
  }
}

function getTicket(): string {
  try {
    return sessionStorage.getItem(TICKET_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setTicket(t: string): void {
  try {
    if (t) sessionStorage.setItem(TICKET_KEY, t);
    else sessionStorage.removeItem(TICKET_KEY);
  } catch (e) {
    /* 忽略 */
  }
}

function newId(): string {
  return 'term-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function nextTitle(tabs: TermTab[]): string {
  const used = tabs
    .map((t) => {
      const m = /^终端\s*(\d+)$/.exec(t.title || '');
      return m ? Number(m[1]) : 0;
    })
    .filter(Boolean);
  return '终端 ' + ((used.length ? Math.max(...used) : 0) + 1);
}

function isReload(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return nav ? nav.type === 'reload' : false;
  } catch (e) {
    return false;
  }
}

export default function Terminal({ active }: { active: boolean }) {
  const [ticket, setTicketState] = useState(() => getTicket());
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tabs, setTabs] = useState<TermTab[]>(() => loadTabs());
  const [current, setCurrent] = useState<string | null>(() => (loadTabs()[0] || {}).id || null);
  const [alive, setAlive] = useState<Set<string>>(() => new Set());
  const [nonce, setNonce] = useState(0);
  const inited = useRef(false);
  const tabsRef = useRef(tabs);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

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

  const refreshAlive = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/term/sessions');
      if (!r.ok) return;
      const d: { sessions?: { name: string }[] } = await r.json();
      setAlive(new Set((d.sessions || []).map((s) => s.name)));
    } catch (e) {
      /* 网络波动忽略 */
    }
  }, []);

  useEffect(() => {
    if (!active || !tabs.length || !ticket) return;
    refreshAlive();
    const t = setInterval(refreshAlive, POLL_MS);
    return () => clearInterval(t);
  }, [active, tabs.length, ticket, refreshAlive]);

  // 离开页面（非刷新）：批量杀掉本页会话
  useEffect(() => {
    let fired = false;
    function onLeave() {
      if (fired) return;
      fired = true;
      if (isReload()) return;
      const names = tabsRef.current.map((t) => t.id);
      if (!names.length) return;
      try {
        const payload = new Blob([JSON.stringify({ names })], { type: 'application/json' });
        navigator.sendBeacon(
          '/api/admin/term/sessions/close',
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

  // 关闭本页所有会话（锁定/离开时复用）
  const killAllSessions = useCallback(async () => {
    const names = tabsRef.current.map((t) => t.id);
    if (!names.length) return;
    try {
      await fetch('/api/admin/term/sessions/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names })
      });
    } catch (e) {
      /* 忽略 */
    }
  }, []);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/term/unlock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: pw })
      });
      const d: { ticket?: string; retryAfter?: number; error?: string } = await r
        .json()
        .catch(() => ({}));
      if (!r.ok || !d.ticket) {
        setErr(
          r.status === 429
            ? `尝试过多，请 ${d.retryAfter || 600} 秒后再试`
            : d.error || '口令不正确'
        );
        setPw('');
        return;
      }
      setTicket(d.ticket);
      setTicketState(d.ticket);
      setPw('');
    } catch (err2) {
      setErr('网络异常，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    await killAllSessions();
    setTicket('');
    setTicketState('');
    setAlive(new Set());
  }

  function addTab() {
    const t = { id: newId(), title: nextTitle(tabs) };
    setTabs((prev) => [...prev, t]);
    setCurrent(t.id);
  }

  async function closeTab(id: string) {
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (current === id) setCurrent(rest.length ? rest[rest.length - 1].id : null);
    try {
      await fetch('/api/admin/term/sessions/' + encodeURIComponent(id), {
        method: 'DELETE'
      });
    } catch (e) {
      /* 忽略 */
    } finally {
      refreshAlive();
    }
  }

  if (!active && !tabs.length) return null;

  // ---- 二次验证门 ----
  if (!ticket) {
    return (
      <div className="term-gate">
        <form className="term-gate-form" onSubmit={unlock}>
          <input
            className="term-gate-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="访问口令"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
          />
          <button className="term-gate-btn" type="submit" disabled={busy || !pw}>
            {busy ? '校验中' : '进入'}
          </button>
        </form>
        {err ? <div className="term-gate-err">{err}</div> : null}
      </div>
    );
  }

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
          className="term-lock"
          onClick={lock}
          title="锁定并关闭全部会话"
        >
          锁定
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
            src={
              '/term/?arg=' +
              encodeURIComponent(t.id) +
              '&arg=' +
              encodeURIComponent(ticket)
            }
            onLoad={() => {
              setTimeout(refreshAlive, 800);
            }}
          />
        ))}
      </div>
    </div>
  );
}
