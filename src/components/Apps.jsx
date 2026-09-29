import { useCallback, useEffect, useRef, useState } from 'react';
import { getApps } from '../api.js';

// 状态词（接口 status → 展示文案，白名单内）
const STATUS_LABEL = {
  up: '正常',
  auth: '需登录',
  degraded: '响应慢',
  down: '异常',
  unknown: '未知'
};

const REFRESH_MS = 30000; // 自动刷新间隔

function statusOf(app) {
  return STATUS_LABEL[app.status] ? app.status : 'unknown';
}

// 单张卡片：有 url 才可点、新窗口打开；url 一律用接口返回值，前端不拼域名
function AppCard({ app }) {
  const status = statusOf(app);
  const label = STATUS_LABEL[status];
  const icon = app.icon || (app.name ? String(app.name).slice(0, 1) : '');
  const hasPort = app.port != null && app.port !== '';
  const hasLatency = app.latencyMs != null && Number.isFinite(Number(app.latencyMs));

  const body = (
    <>
      <span className="apps-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="apps-name">{app.name}</span>
      {app.desc ? <span className="apps-desc">{app.desc}</span> : null}
      <span className="apps-meta">
        <span className={'apps-dot apps-dot--' + status} role="img" aria-label={label} />
        <span className="apps-status">{label}</span>
        {hasPort && (
          <>
            <span className="apps-sep" aria-hidden="true">
              ·
            </span>
            <span className="apps-num">{app.port}</span>
          </>
        )}
        {hasLatency && (
          <>
            <span className="apps-sep" aria-hidden="true">
              ·
            </span>
            <span className="apps-num">{Math.round(Number(app.latencyMs))} ms</span>
          </>
        )}
      </span>
    </>
  );

  if (app.url) {
    return (
      <a
        className="apps-card"
        href={app.url}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={0}
      >
        {body}
      </a>
    );
  }
  return (
    <div className="apps-card apps-card--static" tabIndex={0}>
      {body}
    </div>
  );
}

// 应用面板：只读。首次进入本 Tab 拉一次，之后 30s 自动刷新；
// 页面隐藏时暂停，恢复可见立即刷新；切走/卸载清定时器。
export default function Apps({ active }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  const load = useCallback(async (refresh) => {
    setLoading(true);
    try {
      const res = await getApps({ refresh });
      if (!aliveRef.current) return;
      setData(res && typeof res === 'object' ? res : null);
      setFailed(false);
    } catch (e) {
      if (!aliveRef.current) return;
      setFailed(true); // 保留旧数据（若有）
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    load(false);
    const timer = setInterval(() => {
      if (!document.hidden) load(false);
    }, REFRESH_MS);
    function onVisibility() {
      if (!document.hidden) load(false);
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, load]);

  const apps = Array.isArray(data?.apps) ? data.apps : [];
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  const discovered = Array.isArray(data?.discovered) ? data.discovered : [];

  // 按 categories 顺序分组；组内保持登记表顺序；空组（0 条）不渲染
  const knownIds = new Set(categories.map((c) => c.id));
  const groups = categories
    .map((cat) => ({ cat, items: apps.filter((a) => a.category === cat.id) }))
    .filter((g) => g.items.length > 0);
  const leftovers = apps.filter((a) => !knownIds.has(a.category));
  if (leftovers.length > 0) {
    groups.push({ cat: { id: '__other', name: '其他' }, items: leftovers });
  }

  const hasData = data != null;

  return (
    <div className="apps">
      <div className="system-head">
        <h2>应用</h2>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => load(true)}
          disabled={loading}
          aria-busy={loading}
        >
          刷新
        </button>
      </div>

      {failed && hasData && <div className="apps-warn muted">加载失败</div>}

      {failed && !hasData ? (
        <div className="apps-error">
          <div className="empty">加载失败</div>
          <button type="button" className="btn-ghost" onClick={() => load(false)}>
            重试
          </button>
        </div>
      ) : !hasData ? null : apps.length === 0 ? (
        <div className="empty">暂无应用</div>
      ) : (
        groups.map((g) => (
          <div className="apps-group" key={g.cat.id}>
            <div className="apps-group-head">
              <span className="apps-group-name">{g.cat.name}</span>
              <span className="apps-group-count">· {g.items.length}</span>
            </div>
            <div className="apps-grid">
              {g.items.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          </div>
        ))
      )}

      {discovered.length > 0 && (
        <div className="apps-group apps-group--discovered">
          <div className="apps-group-head">
            <span className="apps-group-name muted">未登记</span>
            <span className="apps-group-count">· {discovered.length}</span>
          </div>
          <div className="apps-disc-list">
            {discovered.map((d, i) => (
              <div className="apps-disc-row" key={d.port != null ? d.port : i}>
                <span className="apps-disc-port">端口 {d.port}</span>
                {d.process ? <span className="apps-disc-proc"> · {d.process}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
