import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppCategory, AppInfo } from '../api';
import AppCard from './AppCard';

const REFRESH_MS = 30000; // 自动刷新间隔

// 公开只读应用中心：只请求 /api/public/apps（同源相对路径，不拼域名、不经后台鉴权入口）。
interface PublicAppsResponse {
  apps?: AppInfo[];
  categories?: AppCategory[];
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

// HH:MM:SS
function clockText(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// 无登录、无侧栏、无其它入口；按分类分组展示卡片，30s 自动刷新。
export default function PublicApps() {
  const [data, setData] = useState<PublicAppsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/public/apps', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PublicAppsResponse;
      if (!aliveRef.current) return;
      setData(json && typeof json === 'object' ? json : null);
      setFailed(false);
      setUpdatedAt(clockText(new Date()));
    } catch {
      if (!aliveRef.current) return;
      setFailed(true); // 保留旧数据（若有）
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    function onVisibility() {
      if (!document.hidden) load();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const apps = Array.isArray(data?.apps) ? data.apps : [];
  const categories = Array.isArray(data?.categories) ? data.categories : [];

  // 按 categories 顺序分组；组内保持接口顺序；空组不渲染；未知分类归入「其他」
  const knownIds = new Set<string | undefined>(categories.map((c) => c.id));
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
        <h2>应用中心</h2>
        {updatedAt ? <span className="apps-updated muted">更新于 {updatedAt}</span> : null}
      </div>

      {failed && hasData && <div className="apps-warn muted">加载失败</div>}

      {failed && !hasData ? (
        <div className="empty">加载失败</div>
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
    </div>
  );
}
