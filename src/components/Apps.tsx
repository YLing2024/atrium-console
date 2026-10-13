import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Divider, Empty, Space, Typography } from 'antd';
import { getApps } from '../api';
import type { AppsResponse } from '../api';
import AppCard from './AppCard';

const REFRESH_MS = 30000; // 自动刷新间隔

// 应用面板：只读。首次进入本 Tab 拉一次，之后 30s 自动刷新；
// 页面隐藏时暂停，恢复可见立即刷新；切走/卸载清定时器。
export default function Apps({ active }: { active: boolean }) {
  const [data, setData] = useState<AppsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  const load = useCallback(async (refresh: boolean) => {
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
        <Typography.Title level={4} style={{ margin: 0 }}>
          应用
        </Typography.Title>
        <Button onClick={() => load(true)} loading={loading}>
          刷新
        </Button>
      </div>

      {failed && hasData && (
        <Alert type="warning" showIcon message="加载失败" style={{ marginBottom: 16 }} />
      )}

      {failed && !hasData ? (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          action={
            <Button size="small" onClick={() => load(false)}>
              重试
            </Button>
          }
        />
      ) : !hasData ? null : apps.length === 0 ? (
        <Empty description="暂无应用" />
      ) : (
        groups.map((g) => (
          <div className="apps-group" key={g.cat.id}>
            <div className="apps-group-head">
              <Typography.Text className="apps-group-name" strong>
                {g.cat.name}
              </Typography.Text>
              <Typography.Text className="apps-group-count" type="secondary">
                · {g.items.length}
              </Typography.Text>
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
        <div className="apps-group">
          <Divider style={{ margin: '0 0 16px' }} />
          <div className="apps-group-head">
            <Typography.Text className="apps-group-name" type="secondary">
              未登记
            </Typography.Text>
            <Typography.Text className="apps-group-count" type="secondary">
              · {discovered.length}
            </Typography.Text>
          </div>
          <Space direction="vertical" size={0}>
            {discovered.map((d, i) => (
              <Typography.Text type="secondary" key={d.port != null ? d.port : i}>
                端口 {d.port}
                {d.process ? ' · ' + d.process : ''}
              </Typography.Text>
            ))}
          </Space>
        </div>
      )}
    </div>
  );
}
