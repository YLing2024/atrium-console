import { useEffect, useRef, useState } from 'react';
import { getNotifications, markNotificationRead, deleteNotification } from '../api.js';
import { useNotificationStream } from '../notificationStream.js';

/**
 * 通知（展示/阅读页）：列表 + 筛选 + 单条已读/删除 + 桌面通知开关。
 * - 页面常驻挂载（Main 中 pane 只切显隐），因此 SSE 在整站打开期间一直在线，
 *   未读徽标与桌面通知在任意 Tab 都能工作。
 * - 实时流走全站单例 notificationStream.js（/api/admin/notifications/stream），绝不复用系统指标 SSE；
 *   顶部状态点展示已连接 / 重连中 / 已断开，重连成功后自动重拉一次对齐数据。
 * - 发通知 / 批量删除 / 清空已读 / 统计 / 接口说明都在「通知管理」「调试」两页，本页不做。
 */

const PAGE = 50;
const DESKTOP_PREF_KEY = 'admin_notifications_desktop';

const LEVEL_LABELS = { urgent: '紧急', normal: '常规', digest: '汇总' };

// ts / readAt 为 epoch 秒
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 同源在当前窗口打开，外链新窗口
function openLink(link) {
  try {
    const u = new URL(link, window.location.origin);
    if (u.origin === window.location.origin) window.location.href = u.href;
    else window.open(u.href, '_blank', 'noopener,noreferrer');
  } catch (e) {
    // 非法链接忽略
  }
}

function readDesktopPref() {
  return localStorage.getItem(DESKTOP_PREF_KEY) === '1';
}

// 顶部状态点的悬停说明（克制：只有文字说明，不弹窗不响铃）
function streamStatusTitle(status) {
  if (status === 'connected') return '实时通道：已连接';
  if (status === 'disconnected') return '实时通道：已断开';
  return '实时通道：重连中';
}

export default function NotificationCenter({ onUnreadChange, onOpen, refreshTick = 0 }) {
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [filterUnread, setFilterUnread] = useState(false);
  const [filterLevel, setFilterLevel] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [permission, setPermission] = useState(() =>
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
  );
  const [desktopPref, setDesktopPref] = useState(readDesktopPref);

  // 供 SSE 回调读取最新值，避免闭包过期
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const filtersRef = useRef({});
  filtersRef.current = { filterUnread, filterLevel, filterSource };
  const desktopPrefRef = useRef(desktopPref);
  desktopPrefRef.current = desktopPref;
  const onUnreadChangeRef = useRef(onUnreadChange);
  onUnreadChangeRef.current = onUnreadChange;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  function addSources(list) {
    if (!list || !list.length) return;
    setSources((prev) => {
      const set = new Set(prev);
      list.forEach((it) => it && it.source && set.add(it.source));
      return Array.from(set).sort();
    });
  }

  function matchesFilter(item) {
    const f = filtersRef.current;
    if (f.filterUnread && item.readAt) return false;
    if (f.filterLevel && item.level !== f.filterLevel) return false;
    if (f.filterSource && item.source !== f.filterSource) return false;
    return true;
  }

  async function refreshUnread() {
    try {
      const d = await getNotifications({ limit: 1 });
      onUnreadChangeRef.current && onUnreadChangeRef.current(d.unread);
      addSources(d.items);
    } catch (e) {
      // 计数刷新失败不打扰页面
    }
  }

  async function load(reset) {
    setLoading(true);
    setError('');
    try {
      const params = { limit: PAGE };
      if (!reset) {
        const last = itemsRef.current[itemsRef.current.length - 1];
        if (last) params.before = last.id;
      }
      if (filterUnread) params.unread = true;
      if (filterLevel) params.level = filterLevel;
      if (filterSource) params.source = filterSource;
      const d = await getNotifications(params);
      const list = Array.isArray(d.items) ? d.items : [];
      setItems((prev) => (reset ? list : prev.concat(list)));
      setHasMore(list.length === PAGE);
      onUnreadChangeRef.current && onUnreadChangeRef.current(d.unread);
      addSources(list);
    } catch (e) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  // 筛选变化：重置列表重新拉取
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUnread, filterLevel, filterSource]);

  // 通知管理页操作（发通知 / 批量删除 / 清空已读）后，由 Main 递增此值触发本页刷新
  useEffect(() => {
    if (!refreshTick) return;
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // 桌面通知：SSE 收到新通知时弹出（仅在已授权且开关打开时）
  function maybeDesktopNotify(item) {
    if (!desktopPrefRef.current) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.Notification.permission !== 'granted') return;
    try {
      const n = new window.Notification(item.title, {
        body: item.body || '',
        tag: 'notif-' + item.id
      });
      n.onclick = () => {
        window.focus();
        if (n.close) n.close();
        onOpenRef.current && onOpenRef.current();
        if (item.link) openLink(item.link);
        else setHighlightId(item.id);
      };
    } catch (e) {
      // 浏览器拒绝构造时静默
    }
  }

  function insertItem(item) {
    addSources([item]);
    if (!matchesFilter(item)) return;
    setItems((prev) => {
      const rest = prev.filter((it) => it.id !== item.id);
      return [item, ...rest];
    });
  }

  // SSE 实时流（全站单例）：收到推送插入列表。
  // 重连成功（再次握手）时重拉一次，补齐断线期间漏掉的通知；
  // 铁律：这里只是「对齐服务器数据」，绝不拿拉取结果做乐观补写。
  function handleStreamNotification(item) {
    insertItem(item);
    maybeDesktopNotify(item);
    refreshUnread();
  }

  function handleStreamResync() {
    load(true);
  }

  const stream = useNotificationStream({
    onNotification: handleStreamNotification,
    onResync: handleStreamResync
  });

  // 高亮 / 滚动到被点击的系统通知对应条目
  useEffect(() => {
    if (highlightId == null) return;
    const el = document.getElementById('notif-' + highlightId);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setHighlightId(null), 2000);
    return () => clearTimeout(t);
  }, [highlightId]);

  async function handleRead(id) {
    try {
      await markNotificationRead(id);
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, readAt: Math.floor(Date.now() / 1000) } : it))
      );
      refreshUnread();
    } catch (e) {
      setError(e.message || '操作失败');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('删除这条通知？')) return;
    try {
      await deleteNotification(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      refreshUnread();
    } catch (e) {
      setError(e.message || '删除失败');
    }
  }

  // 桌面通知授权：必须由用户点击触发
  async function requestDesktop() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    try {
      const result = await window.Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        setDesktopPref(true);
        localStorage.setItem(DESKTOP_PREF_KEY, '1');
      }
    } catch (e) {
      // 用户取消或浏览器异常：不反复打扰
    }
  }

  function toggleDesktop() {
    const next = !desktopPref;
    setDesktopPref(next);
    localStorage.setItem(DESKTOP_PREF_KEY, next ? '1' : '0');
  }

  function renderDesktopControl() {
    if (permission === 'unsupported') {
      return <span className="notif-desktop muted">当前浏览器不支持桌面通知</span>;
    }
    if (permission === 'denied') {
      return <span className="notif-desktop muted">桌面通知已被浏览器阻止</span>;
    }
    if (permission === 'granted') {
      return (
        <button className="notif-desktop" onClick={toggleDesktop}>
          桌面通知 · {desktopPref ? '开' : '关'}
        </button>
      );
    }
    return (
      <button className="notif-desktop" onClick={requestDesktop}>
        开启桌面通知
      </button>
    );
  }

  return (
    <div className="notif">
      <div className="notif-head">
        <div className="notif-title-row">
          <h2>通知</h2>
          <span
            className={'notif-stream-dot ' + stream.status}
            title={streamStatusTitle(stream.status)}
            aria-label={streamStatusTitle(stream.status)}
          />
        </div>
        <div className="notif-head-actions">{renderDesktopControl()}</div>
      </div>

      <div className="notif-bar">
        <div className="notif-seg">
          <button
            className={'notif-seg-btn' + (!filterUnread ? ' active' : '')}
            onClick={() => setFilterUnread(false)}
          >
            全部
          </button>
          <button
            className={'notif-seg-btn' + (filterUnread ? ' active' : '')}
            onClick={() => setFilterUnread(true)}
          >
            未读
          </button>
        </div>
        <div className="notif-selects">
          <select className="notif-select" value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
            <option value="">全部级别</option>
            <option value="urgent">紧急</option>
            <option value="normal">常规</option>
            <option value="digest">汇总</option>
          </select>
          <select
            className="notif-select"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
          >
            <option value="">全部来源</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="notif-error error">{error}</div>}

      <div className="notif-list">
        {items.map((item) => (
          <div
            key={item.id}
            id={'notif-' + item.id}
            className={
              'notif-item' +
              (item.readAt ? ' is-read' : '') +
              (expandedId === item.id ? ' is-open' : '') +
              (highlightId === item.id ? ' is-highlight' : '')
            }
          >
            <button className="notif-main" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
              <span className={'notif-level ' + item.level}>{LEVEL_LABELS[item.level] || item.level}</span>
              <span className="notif-item-title">{item.title}</span>
              <span className="notif-src">{item.source}</span>
              <span className="notif-time mono">{fmtTime(item.ts)}</span>
              {!item.readAt && <span className="notif-dot" />}
            </button>
            {expandedId === item.id && (
              <div className="notif-body">
                {item.body ? <p className="notif-text">{item.body}</p> : <p className="notif-text muted">（无正文）</p>}
                <div className="notif-ops">
                  {item.link && (
                    <button className="link-btn" onClick={() => openLink(item.link)}>
                      打开链接
                    </button>
                  )}
                  {!item.readAt && (
                    <button className="link-btn" onClick={() => handleRead(item.id)}>
                      标为已读
                    </button>
                  )}
                  <button className="link-btn danger" onClick={() => handleDelete(item.id)}>
                    删除
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {!error && loading && items.length === 0 && <div className="notif-empty">加载中…</div>}
        {!error && !loading && items.length === 0 && (
          <div className="notif-empty">{filterUnread ? '没有未读通知' : '还没有通知'}</div>
        )}
        {!error && items.length > 0 && hasMore && (
          <button className="btn-ghost notif-more" onClick={() => load(false)} disabled={loading}>
            {loading ? '加载中…' : '加载更多'}
          </button>
        )}
      </div>
    </div>
  );
}
