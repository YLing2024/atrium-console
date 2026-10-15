import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Badge,
  Button,
  Drawer,
  Empty,
  Image,
  List,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import {
  bulkDeleteNotifications,
  getNotification,
  getNotificationStats,
  getNotificationTypes,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from '../api';
import type { BulkDeleteFilters, NotificationItem, NotificationType } from '../api';
import { subscribeNotificationStream } from '../notificationStream';
import type { NotificationStreamStatus } from '../notificationStream';
import MarkdownBody from './MarkdownBody';

/**
 * 「通知」Tab 面板：归档列表 + 单条详情（富内容）。
 *
 * props：
 * - `active: boolean`（必填，无默认）—— 该 Tab 是否激活；仅激活时拉取列表、刷新未读、连接 SSE，
 *   切走时断开（依赖 notificationStream 单例的订阅计数，最后一个订阅者退订即关闭连接）。
 * - `onUnreadChange: (n: number) => void`（必填）—— 未读总数变化回调，供侧栏徽标展示。
 * - `refreshTick?: number`（默认 0）—— 外部（通知管理页动作后）递增以触发本页重载。
 *
 * 行为要点：
 * - 列表分页用 `before` 游标「加载更多」，每页 50，滚动不自动加载。
 * - 详情视图在 URL 可寻址：`#/notifications/<id>`，刷新后仍能打开；打开即调用单条已读（失败静默）。
 * - 正文用 Markdown 渲染（`MarkdownBody`，先 sanitize 再注入）；图片附件内联并可点击放大（antd `Image`），
 *   其它附件给下载链接；附件地址一律直接使用后端返回的 `url`，前端不再拼接。
 * - 颜色 / 圆角 / 字体一律 antd 默认 token，无自建配色。
 */

const PAGE = 50;

const LEVEL_LABELS: Record<string, string> = { urgent: '紧急', normal: '常规', digest: '汇总' };
const LEVEL_COLORS: Record<string, string> = { urgent: 'red', normal: 'blue', digest: 'default' };
const LEVEL_OPTIONS = [
  { value: '', label: '全部级别' },
  { value: 'urgent', label: '紧急' },
  { value: 'normal', label: '常规' },
  { value: 'digest', label: '汇总' }
];

// ts 为 epoch 秒（列表相对时间、详情绝对时间）
function fmtAbsolute(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function relativeTime(ts: number | null | undefined, now: number): string {
  if (!ts) return '—';
  const diff = Math.max(0, Math.floor(now / 1000) - ts);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return fmtAbsolute(ts);
}

function fmtSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// 详情地址：`#/notifications/<id>`；非详情地址返回 null
function parseNotificationHash(hash: string): number | null {
  const m = /^#\/notifications\/(\d+)$/.exec(hash);
  return m ? Number(m[1]) : null;
}

function isImageMime(mime: string): boolean {
  return typeof mime === 'string' && mime.startsWith('image/');
}

// 同源在当前窗口打开，外链新窗口（后端返回的 link 直接使用）
function openLink(link: string): void {
  try {
    const u = new URL(link, window.location.origin);
    if (u.origin === window.location.origin) window.location.href = u.href;
    else window.open(u.href, '_blank', 'noopener,noreferrer');
  } catch (e) {
    // 非法链接忽略
  }
}

function streamStatusTitle(status: NotificationStreamStatus): string {
  if (status === 'connected') return '实时通道：已连接';
  if (status === 'disconnected') return '实时通道：已断开';
  return '实时通道：重连中';
}

function streamStatusBadge(status: NotificationStreamStatus): 'success' | 'warning' | 'error' {
  if (status === 'connected') return 'success';
  if (status === 'disconnected') return 'error';
  return 'warning';
}

export default function Notifications({
  active,
  onUnreadChange,
  refreshTick = 0
}: {
  active: boolean;
  onUnreadChange: (n: number) => void;
  refreshTick?: number;
}) {
  const { modal } = App.useApp();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [types, setTypes] = useState<NotificationType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [filterUnread, setFilterUnread] = useState(false);
  const [streamStatus, setStreamStatus] = useState<NotificationStreamStatus>('disconnected');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<NotificationItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 供异步回调读取最新值，避免闭包过期
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const filtersRef = useRef({ filterUnread, filterLevel, filterType });
  filtersRef.current = { filterUnread, filterLevel, filterType };
  const onUnreadChangeRef = useRef(onUnreadChange);
  onUnreadChangeRef.current = onUnreadChange;
  const detailIdRef = useRef(detailId);
  detailIdRef.current = detailId;

  // 相对时间定期刷新（不需要每秒）
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      const s = await getNotificationStats();
      onUnreadChangeRef.current(Number(s.unread) || 0);
    } catch (e) {
      // 计数刷新失败不打扰页面
    }
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      setError('');
      try {
        const params: {
          limit: number;
          before?: number;
          level?: string;
          type?: string;
          unread?: boolean;
        } = { limit: PAGE };
        if (!reset) {
          const last = itemsRef.current[itemsRef.current.length - 1];
          if (last) params.before = last.id;
        }
        const f = filtersRef.current;
        if (f.filterUnread) params.unread = true;
        if (f.filterLevel) params.level = f.filterLevel;
        if (f.filterType) params.type = f.filterType;
        const d = await getNotifications(params);
        const list = Array.isArray(d.items) ? d.items : [];
        setItems((prev) => (reset ? list : prev.concat(list)));
        setHasMore(list.length === PAGE);
        onUnreadChangeRef.current(Number(d.unread) || 0);
      } catch (e) {
        setError((e as Error).message || '加载失败');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // 类别清单：仅激活时拉取；只渲染服务端标记 enabled=1 的类别，客户端零类别字符串。
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getNotificationTypes()
      .then((d) => {
        if (alive) setTypes(Array.isArray(d.types) ? d.types : []);
      })
      .catch(() => {
        if (alive) setTypes([]);
      });
    return () => {
      alive = false;
    };
  }, [active]);

  // 激活 / 筛选变化 / 外部刷新：重置并重拉列表；未激活不请求。
  useEffect(() => {
    if (!active) return;
    load(true);
  }, [active, filterUnread, filterLevel, filterType, refreshTick, load]);

  // 激活时刷新未读总数（侧栏徽标）
  useEffect(() => {
    if (active) refreshUnread();
  }, [active, refreshUnread]);

  // 新通知插入列表顶部（按当前筛选过滤；不做乐观补写，仅就地把服务器推送插入）
  function insertItem(item: NotificationItem): void {
    const f = filtersRef.current;
    if (f.filterUnread && item.readAt) return;
    if (f.filterLevel && item.level !== f.filterLevel) return;
    if (f.filterType && (item.type || item.source) !== f.filterType) return;
    setItems((prev) => [item, ...prev.filter((it) => it.id !== item.id)]);
  }
  const insertItemRef = useRef(insertItem);
  insertItemRef.current = insertItem;

  // SSE：仅本 Tab 激活时订阅（单例按引用计数，切走即退订）；断开由单例自动退避重连。
  useEffect(() => {
    if (!active) {
      setStreamStatus('disconnected');
      return;
    }
    return subscribeNotificationStream({
      onState: (s) => setStreamStatus(s.status),
      onNotification: (item) => {
        insertItemRef.current(item);
        refreshUnread();
      },
      onResync: () => load(true)
    });
  }, [active, refreshUnread, load]);

  // 详情：URL 可寻址 `#/notifications/<id>`；打开即调用单条已读（失败静默）。
  function openDetail(id: number): void {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    getNotification(id)
      .then((d) => {
        if (detailIdRef.current !== id) return;
        if (d && d.item) {
          setDetail(d.item);
          if (!d.item.readAt) {
            markNotificationRead(id)
              .then(() => {
                setItems((prev) =>
                  prev.map((it) =>
                    it.id === id ? { ...it, readAt: Math.floor(Date.now() / 1000) } : it
                  )
                );
                refreshUnread();
              })
              .catch(() => {
                // 已读失败静默，不影响阅读
              });
          }
        } else {
          setError('通知不存在');
        }
      })
      .catch((e) => {
        if (detailIdRef.current === id) setError((e as Error).message || '加载失败');
      })
      .finally(() => {
        if (detailIdRef.current === id) setDetailLoading(false);
      });
  }
  const openDetailRef = useRef(openDetail);
  openDetailRef.current = openDetail;

  // 挂载时按 URL 打开详情；hash 变化（前进/后退、点行）同步详情
  useEffect(() => {
    function syncFromHash() {
      const id = parseNotificationHash(window.location.hash);
      if (id != null) openDetailRef.current(id);
      else {
        setDetailId(null);
        setDetail(null);
      }
    }
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  function openRow(item: NotificationItem): void {
    window.location.hash = `#/notifications/${item.id}`;
  }

  function closeDetail(): void {
    if (parseNotificationHash(window.location.hash) != null) window.location.hash = '#/notifications';
    else {
      setDetailId(null);
      setDetail(null);
    }
  }

  // 类别名一律用服务端 label；取不到（旧数据 / 接口失败）才回退原始 key
  function typeLabel(key: string | null | undefined): string {
    if (!key) return '';
    const t = types.find((x) => x.key === key);
    return t && t.label ? t.label : key;
  }

  async function handleReadAll(): Promise<void> {
    try {
      await markAllNotificationsRead();
      const readAt = Math.floor(Date.now() / 1000);
      setItems((prev) => prev.map((it) => (it.readAt ? it : { ...it, readAt })));
      refreshUnread();
    } catch (e) {
      setError((e as Error).message || '操作失败');
    }
  }

  // 按当前筛选批量删除：先 dryRun 拿准确条数 → 二次确认 → 再删
  async function handleBulkDelete(): Promise<void> {
    setError('');
    const f: BulkDeleteFilters = {};
    if (filterType) f.type = filterType;
    if (filterLevel) f.level = filterLevel;
    if (filterUnread) f.unreadOnly = true;
    let count = 0;
    try {
      const d = await bulkDeleteNotifications({ ...f, dryRun: true });
      count = Number(d.count) || 0;
    } catch (e) {
      setError((e as Error).message || '操作失败');
      return;
    }
    if (!count) {
      setError('当前筛选下没有可删除的通知');
      return;
    }
    modal.confirm({
      content: `将删除当前筛选下的 ${count} 条通知，删除后不可恢复。确定继续？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await bulkDeleteNotifications(f);
          await load(true);
          refreshUnread();
        } catch (e) {
          setError((e as Error).message || '批量删除失败');
        }
      }
    });
  }

  const enabledTypes = types.filter((t) => Number(t.enabled) === 1);
  const detailAttachments = detail && Array.isArray(detail.attachments) ? detail.attachments : [];
  const imageAttachments = detailAttachments.filter((a) => isImageMime(a.mime));
  const fileAttachments = detailAttachments.filter((a) => !isImageMime(a.mime));

  return (
    <div className="system">
      <div className="system-head">
        <Space align="center" size={12}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            通知
          </Typography.Title>
          <Tooltip title={streamStatusTitle(streamStatus)}>
            <span role="img" aria-label={streamStatusTitle(streamStatus)}>
              <Badge status={streamStatusBadge(streamStatus)} />
            </span>
          </Tooltip>
        </Space>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12
        }}
      >
        <Segmented
          value={filterUnread ? 'unread' : 'all'}
          onChange={(v) => setFilterUnread(v === 'unread')}
          options={[
            { label: '全部', value: 'all' },
            { label: '未读', value: 'unread' }
          ]}
        />
        <Select
          value={filterLevel}
          onChange={setFilterLevel}
          options={LEVEL_OPTIONS}
          style={{ minWidth: 120 }}
        />
        <Select
          value={filterType}
          onChange={setFilterType}
          options={[
            { value: '', label: '全部类别' },
            ...enabledTypes.map((t) => ({ value: t.key, label: t.label || t.key }))
          ]}
          style={{ minWidth: 140 }}
        />
        <Space style={{ marginLeft: 'auto' }}>
          <Button onClick={handleReadAll}>全部已读</Button>
          <Button danger onClick={handleBulkDelete}>
            按筛选删除
          </Button>
        </Space>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      <List
        dataSource={items}
        locale={{
          emptyText: error
            ? ' '
            : loading && items.length === 0
              ? '加载中…'
              : filterUnread
                ? '没有未读通知'
                : '还没有通知'
        }}
        loadMore={
          !error && items.length > 0 && hasMore ? (
            <div style={{ textAlign: 'center', margin: '16px 0 4px' }}>
              <Button onClick={() => load(false)} loading={loading}>
                {loading ? '加载中…' : '加载更多'}
              </Button>
            </div>
          ) : null
        }
        renderItem={(item) => (
          <List.Item key={item.id} style={{ cursor: 'pointer' }} onClick={() => openRow(item)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
              <Tag color={LEVEL_COLORS[item.level || ''] || 'default'}>
                {LEVEL_LABELS[item.level || ''] || item.level || '—'}
              </Tag>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text
                  strong={!item.readAt}
                  type={item.readAt ? 'secondary' : undefined}
                  ellipsis
                >
                  {item.title}
                </Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.source || '—'} · {typeLabel(item.type || item.source) || '—'}
                  </Typography.Text>
                </div>
              </div>
              {item.hasImage && (
                <Tooltip title="含图片">
                  <PictureOutlined />
                </Tooltip>
              )}
              <Tooltip title={fmtAbsolute(item.ts)}>
                <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                  {relativeTime(item.ts, now)}
                </Typography.Text>
              </Tooltip>
              {!item.readAt && <Badge status="processing" />}
            </div>
          </List.Item>
        )}
      />

      <Drawer
        open={detailId != null}
        onClose={closeDetail}
        width={640}
        title={detail ? detail.title : '通知'}
      >
        {detailLoading ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : detail ? (
          <div>
            <Space wrap size={16} style={{ marginBottom: 12 }}>
              <span>
                来源 <Typography.Text>{detail.source || '—'}</Typography.Text>
              </span>
              <span>
                类别{' '}
                <Typography.Text>{typeLabel(detail.type || detail.source) || '—'}</Typography.Text>
              </span>
              <span>
                级别{' '}
                <Tag color={LEVEL_COLORS[detail.level || ''] || 'default'}>
                  {LEVEL_LABELS[detail.level || ''] || detail.level || '—'}
                </Tag>
              </span>
              <span>
                时间 <Typography.Text>{fmtAbsolute(detail.ts) || '—'}</Typography.Text>
              </span>
            </Space>

            {detail.body ? (
              <MarkdownBody text={detail.body} className="notif-md" />
            ) : (
              <Typography.Paragraph type="secondary">（无正文）</Typography.Paragraph>
            )}

            {(imageAttachments.length > 0 || fileAttachments.length > 0) && (
              <div style={{ marginTop: 16 }}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {imageAttachments.map((a) => (
                    <Image
                      key={a.name}
                      src={a.url}
                      alt={a.name}
                      style={{ maxWidth: '100%' }}
                    />
                  ))}
                  {fileAttachments.map((a) => (
                    <Typography.Link
                      key={a.name}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {a.name}
                      {fmtSize(a.size) ? `（${fmtSize(a.size)}）` : ''}
                    </Typography.Link>
                  ))}
                </Space>
              </div>
            )}

            {detail.link && (
              <div style={{ marginTop: 12 }}>
                <Button type="link" style={{ paddingLeft: 0 }} onClick={() => openLink(detail.link as string)}>
                  打开链接
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Empty description="通知不存在" />
        )}
      </Drawer>
    </div>
  );
}
