/**
 * Logs —— 云 MySQL 日志检索页（/logs）。
 *
 * 数据来自 `GET /api/admin/logs`，日志由 loghub 采集入 admin_logs：
 *   system（journald 全单元）/ container（docker）/ file（业务文件）/ access / error（nginx）
 *
 * 交互：来源切换、关键字搜索（回车触发）、时间范围；表格内部滚动到底自动加载下一页，
 * 点击任意行打开详情抽屉（完整内容 / 复制全文 / 复制 JSON）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from 'antd';
import type { TableColumnsType } from 'antd';
import { request } from '../api';
import {
  buildLogDetailFields,
  copyLogText,
  formatLogTime,
  levelColor,
  logJson,
  nextLogOffset,
  shouldAutoLoad,
  sourceLabel,
  type LogEntry,
  type LogResult
} from '../logs';

const SOURCES = ['system', 'container', 'file', 'access', 'error'].map((value) => ({
  value,
  label: sourceLabel(value)
}));

const RANGES = [
  { value: '1h', label: '近 1 小时' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' }
];

const PAGE = 200;
/** 矮窗口下表格不被压扁；此时页面允许出现外层滚动，优先保证可读性。 */
const MIN_TABLE_HEIGHT = 360;
/** 距底部多少像素内视为「到底」，留一点余量让加载更跟手。 */
const LOAD_THRESHOLD = 80;

// 从 URL 读初始筛选，保证刷新/分享后状态一致。
function readInitial() {
  const p = new URLSearchParams(location.search);
  return {
    source: p.get('source') || 'system',
    range: p.get('range') || '24h',
    q: p.get('q') || ''
  };
}

/** 详情抽屉内容：字段表 + 等宽完整内容 + 复制动作。 */
function LogDetail({ entry }: { entry: LogEntry }) {
  const { message } = App.useApp();
  const fields = buildLogDetailFields(entry);

  async function copy(text: string, label: string) {
    if (await copyLogText(text)) message.success(`${label}已复制`);
    else message.error('复制失败，请手动选择内容');
  }

  return (
    <>
      <div className="logs-detail-head">
        <Tag>{sourceLabel(entry.source)}</Tag>
        {entry.level && <Tag color={levelColor(entry.level)}>{entry.level}</Tag>}
        <Typography.Text type="secondary" className="monitor-num">
          {formatLogTime(entry.ts)}
        </Typography.Text>
      </div>

      {fields.length > 0 && (
        <Descriptions
          column={1}
          bordered
          size="small"
          className="logs-detail-fields"
          items={fields.map((field, index) => ({
            key: `${field.label}-${index}`,
            label: field.label,
            children: <span className="logs-detail-value">{field.value}</span>
          }))}
        />
      )}

      <section className="logs-detail-body">
        <div className="logs-detail-body-title">完整内容</div>
        <pre className="logs-detail-pre">{entry.message}</pre>
      </section>

      <div className="logs-detail-actions">
        <Button onClick={() => void copy(entry.message, '全文')}>复制全文</Button>
        <Button onClick={() => void copy(logJson(entry), 'JSON')}>复制为 JSON</Button>
      </div>
    </>
  );
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
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [tableY, setTableY] = useState(MIN_TABLE_HEIGHT);

  const reqId = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(false);
  const offsetRef = useRef(0);
  const tableViewportRef = useRef<HTMLDivElement>(null);
  const lastRowRef = useRef<HTMLElement | null>(null);

  const loadPage = useCallback(
    async (offset: number) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError('');
      const id = ++reqId.current;
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
        hasMoreRef.current = res.hasMore;
        offsetRef.current = nextLogOffset(res, PAGE);
      } catch (e) {
        // 失败不自动重试：保留 hasMore，等用户点「加载失败，点击重试」。
        if (id === reqId.current) setError((e as Error).message || '加载失败');
      } finally {
        if (id === reqId.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [source, range, applied]
  );

  // 筛选变化：作废在途请求、清空列表并从 offset=0 重来。
  useEffect(() => {
    reqId.current += 1;
    loadingRef.current = false;
    hasMoreRef.current = false;
    offsetRef.current = 0;
    setRows([]);
    setHasMore(false);
    setError('');
    setSelected(null);
    void loadPage(0);
  }, [loadPage]);

  // 筛选变化同步到地址栏（replaceState）。
  // 只有本页可见时才写 URL：常驻挂载的隐藏面板不能劫持当前路由。
  useEffect(() => {
    if (!active) return;
    const p = new URLSearchParams();
    p.set('source', source);
    p.set('range', range);
    if (applied) p.set('q', applied);
    history.replaceState(null, '', `/logs?${p.toString()}`);
  }, [active, source, range, applied]);

  // 量出卡片内可用高度，减掉表头就是表格滚动区；窗口缩放时由 ResizeObserver 实时更新。
  useEffect(() => {
    const el = tableViewportRef.current;
    if (!el) return;
    const sync = () => {
      const head = el.querySelector<HTMLElement>('.ant-table-thead');
      const headHeight = head ? head.getBoundingClientRect().height : 39;
      const next = Math.max(MIN_TABLE_HEIGHT, Math.floor(el.clientHeight - headHeight));
      setTableY((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const retry = useCallback(() => {
    setError('');
    void loadPage(offsetRef.current);
  }, [loadPage]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    if (!el.classList.contains('ant-table-body')) return;
    if (
      shouldAutoLoad(
        {
          scrollTop: el.scrollTop,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          loading: loadingRef.current,
          hasMore: hasMoreRef.current,
          failed: Boolean(error)
        },
        LOAD_THRESHOLD
      )
    ) {
      void loadPage(offsetRef.current);
    }
  }

  const columns: TableColumnsType<LogEntry> = [
    {
      title: '时间',
      dataIndex: 'ts',
      key: 'ts',
      width: 180,
      render: (v: string) => <span className="monitor-num">{formatLogTime(v)}</span>
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
        <span
          className="log-message-cell"
          onClick={(e) => {
            // 只拦复制图标，正文仍可点击整行打开详情。
            if ((e.target as HTMLElement).closest('.ant-typography-copy')) e.stopPropagation();
          }}
        >
          <Typography.Text className="log-message" copyable={{ text: v }} ellipsis={{ tooltip: v }}>
            {v}
          </Typography.Text>
        </span>
      )
    }
  ];

  const footer = (
    <div className="logs-loadfoot" role="status" aria-live="polite">
      {error ? (
        <Button type="link" size="small" onClick={retry}>
          加载失败，点击重试
        </Button>
      ) : loading && rows.length > 0 ? (
        <span className="logs-loading">
          <Spin size="small" /> 加载中
        </span>
      ) : !hasMore && rows.length > 0 ? (
        <Typography.Text type="secondary" className="logs-loading">
          到底了
        </Typography.Text>
      ) : null}
    </div>
  );

  return (
    <div className="logs-page">
      <Card
        className="monitor-card logs-card"
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
          <Button
            onClick={() => {
              setKeyword('');
              setApplied('');
            }}
          >
            重置
          </Button>
        </Space>

        <div className="logs-table-wrap" ref={tableViewportRef} onScrollCapture={handleScroll}>
          <Table<LogEntry>
            rowKey={(r, i) => `${r.ts}-${r.source}-${r.name}-${i}`}
            size="small"
            columns={columns}
            dataSource={rows}
            loading={loading && rows.length === 0}
            pagination={false}
            scroll={{ y: tableY, x: 720 }}
            rowClassName={() => 'logs-row-clickable'}
            onRow={(record) => ({
              tabIndex: 0,
              onClick: (e) => {
                lastRowRef.current = e.currentTarget;
                setSelected(record);
              },
              onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  lastRowRef.current = e.currentTarget;
                  setSelected(record);
                }
              }
            })}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的日志" />
            }}
          />
        </div>

        {footer}
      </Card>

      <Drawer
        title="日志详情"
        open={selected !== null}
        onClose={() => setSelected(null)}
        width={720}
        className="logs-detail-drawer"
        styles={{ wrapper: { maxWidth: '100vw' } }}
        afterOpenChange={(open) => {
          // 关闭后把焦点还给触发的那一行，键盘用户不丢位置。
          if (!open) lastRowRef.current?.focus();
        }}
      >
        {selected && <LogDetail entry={selected} />}
      </Drawer>
    </div>
  );
}
