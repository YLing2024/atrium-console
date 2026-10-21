/**
 * Logs —— 云 MySQL 日志检索页（/logs）。
 *
 * 数据来自 `GET /api/admin/logs`，日志由 loghub 采集入 admin_logs：
 *   system（journald 全单元）/ container（docker）/ file（业务文件）/ access / error（nginx）
 *
 * 交互：来源切换、关键字搜索（回车触发）、时间范围、滚动加载更多、复制单行。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Empty, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { request } from '../api';

interface LogEntry {
  ts: string;
  source: string;
  name: string;
  level: string;
  message: string;
}

interface LogResult {
  entries: LogEntry[];
  hasMore: boolean;
  source: string;
  limit: number;
  offset: number;
}

const SOURCES = [
  { value: 'system', label: '系统 journald' },
  { value: 'container', label: '容器' },
  { value: 'file', label: '业务文件' },
  { value: 'access', label: 'Nginx access' },
  { value: 'error', label: 'Nginx error' }
];

const RANGES = [
  { value: '1h', label: '近 1 小时' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' }
];

const PAGE = 200;

/** 级别 → Tag 颜色，未识别的不上色。 */
function levelColor(level: string): string {
  switch (level) {
    case 'error':
      return 'error';
    case 'warn':
      return 'warning';
    case 'notice':
      return 'blue';
    case 'debug':
      return 'default';
    default:
      return 'default';
  }
}

// 从 URL 读初始筛选，保证刷新/分享后状态一致。
function readInitial() {
  const p = new URLSearchParams(location.search);
  return {
    source: p.get('source') || 'system',
    range: p.get('range') || '24h',
    q: p.get('q') || ''
  };
}

export default function Logs({ active = true }: { active?: boolean }) {
  const initial = readInitial();
  const [source, setSource] = useState(initial.source);
  const [range, setRange] = useState(initial.range);
  const [keyword, setKeyword] = useState(initial.q);
  const [applied, setApplied] = useState(initial.q);
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reqId = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const id = ++reqId.current;
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          source,
          since: range,
          limit: String(PAGE),
          offset: String(offset)
        });
        if (applied) params.set('q', applied);
        const res = await request<LogResult>(`/api/admin/logs?${params.toString()}`);
        if (id !== reqId.current) return;
        setRows((prev) => (offset === 0 ? res.entries : [...prev, ...res.entries]));
        setHasMore(res.hasMore);
      } catch (e) {
        if (id === reqId.current) setError((e as Error).message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [source, range, applied]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  // 筛选变化同步到地址栏（replaceState）。
  // 只有本页可见时才写 URL：常驻挂载的隐藏面板不能劫持当前路由。
  useEffect(() => {
    if (!active) return;
    const p = new URLSearchParams();
    p.set('source', source);
    p.set('range', range);
    if (applied) p.set('q', applied);
    history.replaceState(null, '', `/logs?${p.toString()}`);
  }, [source, range, applied]);

  const columns: TableColumnsType<LogEntry> = [
    {
      title: '时间',
      dataIndex: 'ts',
      key: 'ts',
      width: 180,
      render: (v: string) => <span className="monitor-num">{v.replace('T', ' ').replace('Z', '')}</span>
    },
    {
      title: '来源',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (v: string) => v || '—'
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 90,
      render: (v: string) => (v ? <Tag color={levelColor(v)}>{v}</Tag> : '—')
    },
    {
      title: '内容',
      dataIndex: 'message',
      key: 'message',
      render: (v: string) => (
        <Typography.Text
          className="log-message"
          copyable={{ text: v }}
          ellipsis={{ tooltip: v }}
        >
          {v}
        </Typography.Text>
      )
    }
  ];

  return (
    <div className="logs-page">
      <Card
        className="monitor-card"
        title="日志"
        extra={
          <Typography.Text type="secondary" className="monitor-num">
            已加载 {rows.length} 条{hasMore ? ' · 还有更多' : ''}
          </Typography.Text>
        }
      >
        <Space wrap size={12} className="logs-toolbar">
          <Select
            value={source}
            onChange={(v) => setSource(v)}
            options={SOURCES}
            style={{ width: 160 }}
            aria-label="日志来源"
          />
          <Select
            value={range}
            onChange={(v) => setRange(v)}
            options={RANGES}
            style={{ width: 140 }}
            aria-label="时间范围"
          />
          <Input.Search
            allowClear
            placeholder="关键字（单元名 / 路径 / 内容）"
            style={{ width: 320 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(v) => setApplied(v.trim())}
            enterButton="搜索"
          />
          <Button onClick={() => { setKeyword(''); setApplied(''); }}>重置</Button>
        </Space>

        {error && <div className="logs-error">{error}</div>}

        <Table<LogEntry>
          rowKey={(r, i) => `${r.ts}-${i}`}
          size="small"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={false}
          scroll={{ y: 520 }}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的日志" />
          }}
        />

        <div className="logs-footer">
          <Button
            onClick={() => void load(rows.length)}
            disabled={!hasMore || loading}
            loading={loading}
          >
            {hasMore ? '加载更多' : '到底了'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
