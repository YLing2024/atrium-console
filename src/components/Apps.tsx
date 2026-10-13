import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Divider, Empty, Row, Space, Typography } from 'antd';
import { getApps } from '../api';
import type { AppInfo, AppsResponse } from '../api';
import { STATUS_LABEL, statusOf } from '../appStatus';
import AppIcon from './AppIcon';

const REFRESH_MS = 30000; // 自动刷新间隔

// 状态 → antd Badge 外观（判定沿用 appStatus 的既有逻辑，这里只做展示映射）
const BADGE_STATUS: Record<string, 'success' | 'processing' | 'warning' | 'error' | 'default'> = {
  up: 'success',
  auth: 'processing',
  degraded: 'warning',
  down: 'error',
  idle: 'default',
  unknown: 'default'
};

// 单张应用卡片：antd Card 承载；有 url 时整卡可点、新窗口打开（url 一律用接口返回值）。
function AppAntCard({ app }: { app: AppInfo }) {
  const status = statusOf(app);
  const label = STATUS_LABEL[status];
  const hasPort = app.port != null && app.port !== '';
  const hasLatency = app.latencyMs != null && Number.isFinite(Number(app.latencyMs));

  const card = (
    <Card size="small" hoverable={!!app.url} style={{ height: '100%' }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space align="center" size={8}>
          <AppIcon name={app.icon} fallback={app.name} />
          <Typography.Text strong>{app.name}</Typography.Text>
        </Space>
        {app.desc ? (
          <Typography.Text type="secondary" ellipsis style={{ display: 'block' }}>
            {app.desc}
          </Typography.Text>
        ) : null}
        <Space size={8} wrap>
          <Badge status={BADGE_STATUS[status] ?? 'default'} text={label} />
          {hasPort && <Typography.Text type="secondary">端口 {app.port}</Typography.Text>}
          {hasLatency && (
            <Typography.Text type="secondary">
              {Math.round(Number(app.latencyMs))} ms
            </Typography.Text>
          )}
        </Space>
      </Space>
    </Card>
  );

  if (app.url) {
    return (
      <a
        href={app.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
      >
        {card}
      </a>
    );
  }
  return card;
}

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
          <Fragment key={g.cat.id}>
            <Divider orientation="left" orientationMargin={0}>
              {g.cat.name} · {g.items.length}
            </Divider>
            <Row gutter={[16, 16]}>
              {g.items.map((app) => (
                <Col key={app.id} xs={24} sm={12} md={8}>
                  <AppAntCard app={app} />
                </Col>
              ))}
            </Row>
          </Fragment>
        ))
      )}

      {discovered.length > 0 && (
        <>
          <Divider orientation="left" orientationMargin={0}>
            未登记 · {discovered.length}
          </Divider>
          <Space direction="vertical" size={0}>
            {discovered.map((d, i) => (
              <Typography.Text type="secondary" key={d.port != null ? d.port : i}>
                端口 {d.port}
                {d.process ? ' · ' + d.process : ''}
              </Typography.Text>
            ))}
          </Space>
        </>
      )}
    </div>
  );
}
