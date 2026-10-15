import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Image,
  List,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import { getNotifications, getNotification, getNotificationTypes, markNotificationRead, deleteNotification } from '../api';
import type { NotificationItem, NotificationParams, NotificationType } from '../api';
import { useNotificationStream } from '../notificationStream';
import type { NotificationStreamStatus } from '../notificationStream';
import MarkdownBody from './MarkdownBody';

/**
 * 通知（展示/阅读页）：列表 + 筛选 + 单条已读/删除 + 桌面通知开关。
 * - 页面常驻挂载（Main 中 pane 只切显隐），因此 SSE 在整站打开期间一直在线，
 *   未读徽标与桌面通知在任意 Tab 都能工作。
 * - 实时流走全站单例 notificationStream.js（/api/admin/notifications/stream），绝不复用系统指标 SSE；
 *   顶部状态点展示已连接 / 重连中 / 已断开，重连成功后自动重拉一次对齐数据。
 * - 附件：列表行在 `hasImage` 为真时显示图片标记；展开后正文下方渲染附件——图片用 antd Image
 *   （点击放大），其余给下载链接。附件 url 是后端返回的同源相对路径，直接使用、不拼域名。
 * - 发通知 / 批量删除 / 清空已读 / 统计 / 接口说明都在「通知管理」「调试」两页，本页不做。
 */

const PAGE = 50;
const DESKTOP_PREF_KEY = 'admin_notifications_desktop';

const LEVEL_LABELS: Record<string, string> = { urgent: '紧急', normal: '常规', digest: '汇总' };

// ts / readAt 为 epoch 秒
// 列表摘要用短时间（到分）；展开详情用完整时间（到秒，YYYY-MM-DD HH:mm:ss）。
function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtTimeFull(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 同源在当前窗口打开，外链新窗口
function openLink(link: string): void {
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
function streamStatusTitle(status: NotificationStreamStatus): string {
  if (status === 'connected') return '实时通道：已连接';
  if (status === 'disconnected') return '实时通道：已断开';
  return '实时通道：重连中';
}

// 状态点映射到 antd Badge 语义色
function streamStatusBadge(status: NotificationStreamStatus): 'success' | 'warning' | 'error' {
  if (status === 'connected') return 'success';
  if (status === 'disconnected') return 'error';
  return 'warning';
}

const LEVEL_OPTIONS = [
  { value: '', label: '全部级别' },
  { value: 'urgent', label: '紧急' },
  { value: 'normal', label: '常规' },
  { value: 'digest', label: '汇总' }
];

export default function NotificationCenter({
  onUnreadChange,
  onOpen,
  refreshTick = 0
}: {
  onUnreadChange: (n: number) => void;
  onOpen: () => void;
  refreshTick?: number;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  // 通知类别由服务端定义：客户端不内置任何类别字符串，一律从 /notifications/types 拉取。
  const [types, setTypes] = useState<NotificationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [filterUnread, setFilterUnread] = useState(false);
  const [filterLevel, setFilterLevel] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterType, setFilterType] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // 展开行的单条详情：正文与附件以详情接口为准；未到达时先用列表数据渲染。
  const [detail, setDetail] = useState<NotificationItem | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [permission, setPermission] = useState(() =>
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
  );
  const [desktopPref, setDesktopPref] = useState(readDesktopPref);

  // 供 SSE 回调读取最新值，避免闭包过期
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const filtersRef = useRef({
    filterUnread: false,
    filterLevel: '',
    filterSource: '',
    filterType: ''
  });
  filtersRef.current = { filterUnread, filterLevel, filterSource, filterType };
  const desktopPrefRef = useRef(desktopPref);
  desktopPrefRef.current = desktopPref;
  const onUnreadChangeRef = useRef(onUnreadChange);
  onUnreadChangeRef.current = onUnreadChange;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  function addSources(list: NotificationItem[] | null | undefined): void {
    if (!list || !list.length) return;
    setSources((prev) => {
      const set = new Set(prev);
      list.forEach((it) => it && it.source && set.add(it.source));
      return Array.from(set).sort();
    });
  }

  // 类别名一律用服务端 label；取不到（旧数据 / 接口失败 / 已归档）才回退原始 key。
  function typeLabel(key: string | null | undefined): string {
    if (!key) return '';
    const t = types.find((x) => x.key === key);
    return t && t.label ? t.label : key;
  }

  function matchesFilter(item: NotificationItem): boolean {
    const f = filtersRef.current;
    if (f.filterUnread && item.readAt) return false;
    if (f.filterLevel && item.level !== f.filterLevel) return false;
    if (f.filterSource && item.source !== f.filterSource) return false;
    if (f.filterType && (item.type || item.source) !== f.filterType) return false;
    return true;
  }

  async function refreshUnread() {
    try {
      const d = await getNotifications({ limit: 1 });
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- ref.current 短路调用是既有写法，保留行为不变
      onUnreadChangeRef.current && onUnreadChangeRef.current(d.unread);
      addSources(d.items);
    } catch (e) {
      // 计数刷新失败不打扰页面
    }
  }

  async function load(reset: boolean) {
    setLoading(true);
    setError('');
    try {
      const params: NotificationParams = { limit: PAGE };
      if (!reset) {
        const last = itemsRef.current[itemsRef.current.length - 1];
        if (last) params.before = last.id;
      }
      if (filterUnread) params.unread = true;
      if (filterLevel) params.level = filterLevel;
      if (filterSource) params.source = filterSource;
      if (filterType) params.type = filterType;
      const d = await getNotifications(params);
      const list = Array.isArray(d.items) ? d.items : [];
      setItems((prev) => (reset ? list : prev.concat(list)));
      setHasMore(list.length === PAGE);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- ref.current 短路调用是既有写法，保留行为不变
      onUnreadChangeRef.current && onUnreadChangeRef.current(d.unread);
      addSources(list);
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  // 类别清单：进入通知页时从接口拉取；只用于渲染筛选器与列表项类别名。
  // 接口失败 → 降级为空清单（筛选器只剩「全部类别」，列表项回退原始 key），不阻塞列表加载。
  useEffect(() => {
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
  }, []);

  // 筛选变化：重置列表重新拉取
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUnread, filterLevel, filterSource, filterType]);

  // 通知管理页操作（发通知 / 批量删除 / 清空已读）后，由 Main 递增此值触发本页刷新
  useEffect(() => {
    if (!refreshTick) return;
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // 桌面通知：SSE 收到新通知时弹出（仅在已授权且开关打开时）
  function maybeDesktopNotify(item: NotificationItem): void {
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
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- ref.current 短路调用是既有写法，保留行为不变
        onOpenRef.current && onOpenRef.current();
        if (item.link) openLink(item.link);
        else setHighlightId(item.id);
      };
    } catch (e) {
      // 浏览器拒绝构造时静默
    }
  }

  function insertItem(item: NotificationItem): void {
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
  function handleStreamNotification(item: NotificationItem): void {
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

  // 展开/收起一条通知：展开时取单条详情，正文与附件以详情为准确源
  // （列表数据已带正文与附件元信息，详情到达前/失败时直接用它，不阻塞阅读）。
  function toggleExpand(id: number): void {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    getNotification(id)
      .then((d) => {
        if (d && d.item) setDetail(d.item);
      })
      .catch(() => {
        // 详情拉取失败时退回列表数据，不打扰页面
      });
  }

  async function handleRead(id: number) {
    try {
      await markNotificationRead(id);
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, readAt: Math.floor(Date.now() / 1000) } : it))
      );
      refreshUnread();
    } catch (e) {
      setError((e as Error).message || '操作失败');
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteNotification(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      refreshUnread();
    } catch (e) {
      setError((e as Error).message || '删除失败');
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
      return <Typography.Text type="secondary">当前浏览器不支持桌面通知</Typography.Text>;
    }
    if (permission === 'denied') {
      return <Typography.Text type="secondary">桌面通知已被浏览器阻止</Typography.Text>;
    }
    if (permission === 'granted') {
      return (
        <Button onClick={toggleDesktop}>桌面通知 · {desktopPref ? '开' : '关'}</Button>
      );
    }
    return <Button onClick={requestDesktop}>开启桌面通知</Button>;
  }

  // 筛选器只展示服务端标记为 enabled 的类别（停用的历史类别不出现在这里，但其通知仍可按类别查）。
  const enabledTypes = types.filter((t) => Number(t.enabled) === 1);

  return (
    <div className="system">
      <div className="system-head">
        <Space align="center" size={12}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            通知
          </Typography.Title>
          <Tooltip title={streamStatusTitle(stream.status)}>
            <span role="img" aria-label={streamStatusTitle(stream.status)}>
              <Badge status={streamStatusBadge(stream.status)} />
            </span>
          </Tooltip>
        </Space>
        <div>{renderDesktopControl()}</div>
      </div>

      <Space wrap size={12} style={{ marginBottom: 12 }}>
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
          style={{ minWidth: 120 }}
        />
        <Select
          value={filterSource}
          onChange={setFilterSource}
          options={[
            { value: '', label: '全部来源' },
            ...sources.map((s) => ({ value: s, label: s }))
          ]}
          style={{ minWidth: 120 }}
        />
      </Space>

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
        renderItem={(item) => {
          const view = detail && detail.id === item.id ? detail : item;
          const files = Array.isArray(view.attachments) ? view.attachments : [];
          const imageAttachments = files.filter((a) => a.mime.startsWith('image/'));
          const otherAttachments = files.filter((a) => !a.mime.startsWith('image/'));
          return (
          <List.Item key={item.id}>
            <div id={'notif-' + item.id} style={{ width: '100%' }}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expandedId === item.id}
                onClick={() => toggleExpand(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleExpand(item.id);
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
              >
                <Tag>{LEVEL_LABELS[item.level as string] || item.level}</Tag>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Typography.Text
                    strong={!item.readAt}
                    type={item.readAt ? 'secondary' : undefined}
                  >
                    {item.title}
                  </Typography.Text>
                  {item.body && (
                    <Typography.Paragraph
                      type="secondary"
                      ellipsis={{ rows: 3 }}
                      style={{ marginBottom: 0 }}
                    >
                      {item.body}
                    </Typography.Paragraph>
                  )}
                </div>
                {item.hasImage && (
                  <Tooltip title="含图片">
                    <PictureOutlined aria-label="含图片" />
                  </Tooltip>
                )}
                <Typography.Text type="secondary">
                  {typeLabel(item.type || item.source)}
                </Typography.Text>
                <Typography.Text type="secondary">{fmtTime(item.ts)}</Typography.Text>
                {!item.readAt && <Badge status="processing" />}
              </div>

              {expandedId === item.id && (
                <div style={{ paddingTop: 12 }}>
                  {view.body ? (
                    <MarkdownBody text={view.body} />
                  ) : (
                    <Typography.Paragraph type="secondary">（无正文）</Typography.Paragraph>
                  )}
                  {(imageAttachments.length > 0 || otherAttachments.length > 0) && (
                    <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
                      {imageAttachments.map((a) => (
                        <Image key={a.name} src={a.url} alt={a.name} style={{ maxWidth: '100%' }} />
                      ))}
                      {otherAttachments.map((a) => (
                        <a key={a.name} href={a.url} target="_blank" rel="noopener noreferrer">
                          {a.name}
                        </a>
                      ))}
                    </Space>
                  )}
                  <Space size={16} wrap style={{ marginTop: 12, marginBottom: 12 }}>
                    <span>
                      类别 <Typography.Text>{typeLabel(view.type || view.source) || '—'}</Typography.Text>
                    </span>
                    <span>
                      级别{' '}
                      <Typography.Text>
                        {LEVEL_LABELS[view.level as string] || view.level || '—'}
                      </Typography.Text>
                    </span>
                    <span>
                      来源 <Typography.Text>{view.source || '—'}</Typography.Text>
                    </span>
                    <span>
                      时间 <Typography.Text>{fmtTimeFull(view.ts) || '—'}</Typography.Text>
                    </span>
                  </Space>
                  <Space size={0}>
                    {view.link && (
                      <Button type="link" size="small" onClick={() => openLink(view.link as string)}>
                        打开链接
                      </Button>
                    )}
                    {!item.readAt && (
                      <Button type="link" size="small" onClick={() => handleRead(item.id)}>
                        标为已读
                      </Button>
                    )}
                    <Popconfirm
                      title="删除这条通知？"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => handleDelete(item.id)}
                    >
                      <Button type="link" size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
              )}
            </div>
          </List.Item>
          );
        }}
      />
    </div>
  );
}
