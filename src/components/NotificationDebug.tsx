import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Table,
  Typography
} from 'antd';
import type { TableProps } from 'antd';
import { createNotification, getNotifications } from '../api';
import type { ApiError } from '../api';
import { usePushWait } from '../notificationPush';
import { useNotificationStream, notificationStreamLabel } from '../notificationStream';
import PushWaitResult from './PushWaitResult';

/**
 * 通知调试（调试页的第一个工具）：
 *  1) 实时状态：SSE 是否已连接、最近一次事件/心跳时间（相对）、当前未读数；
 *  2) 发一条测试通知（默认 source=admin-debug）：POST 成功后不本地刷新未读、不插入，
 *     只等待服务器 SSE 推回并显示耗时/超时（连通性检测）；
 *  3) 接口说明：字段表 + 运行时域名拼出的可复制 curl；
 *  4) 调用结果：最近一次调用的 HTTP 状态与响应体（截断）。
 *
 * 域名一律运行时取 window.location.origin，禁止硬编码（仓库红线）。
 */

const TRUNCATE = 600;

const LEVEL_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'normal', label: '常规' },
  { value: 'digest', label: '汇总' }
];

interface FieldRow {
  field: string;
  required: string;
  desc: string;
}

const FIELD_ROWS: FieldRow[] = [
  { field: 'level', required: '是', desc: 'urgent / normal / digest' },
  { field: 'source', required: '是', desc: '来源标识，如 admin / debug' },
  { field: 'title', required: '是', desc: '标题，≤ 80 字' },
  { field: 'body', required: '否', desc: '正文，纯文本' },
  { field: 'link', required: '否', desc: '跳转链接' },
  { field: 'dedupKey', required: '否', desc: '去重键，10 分钟内相同键只保留一条' }
];

function relativeTime(ts: number | null | undefined, now: number): string {
  if (!ts) return '—';
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function truncate(text: unknown): string {
  const s = String(text == null ? '' : text);
  return s.length > TRUNCATE ? s.slice(0, TRUNCATE) + '…' : s;
}

export default function NotificationDebug() {
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const [level, setLevel] = useState('normal');
  const [title, setTitle] = useState('测试通知');
  const [body, setBody] = useState('来自 Admin 的调试消息');
  const [sending, setSending] = useState(false);
  const [callResult, setCallResult] = useState<{
    ok: boolean;
    status: number;
    body: string;
    at: number;
  } | null>(null); // { ok, status, body, at }
  const [copied, setCopied] = useState(false);
  const [repulled, setRepulled] = useState(false);
  const { pushState, beginPushWait, markWaiting, resetPushWait } = usePushWait();

  const curlRef = useRef(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const curl =
    `curl -X POST ${origin}/api/admin/notifications \\\n` +
    `  -H 'Content-Type: application/json' \\\n` +
    `  -H 'Authorization: Bearer <API Token>' \\\n` +
    `  -d '{"level":"normal","source":"debug","title":"测试通知","body":"来自 Admin 调试"}'`;

  // 相对时间每秒刷新
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function refreshUnread() {
    try {
      const d = await getNotifications({ limit: 1 });
      setUnread(Number(d.unread) || 0);
    } catch (e) {
      // 忽略
    }
  }

  // 未读数：挂载时 + 每 15s 兜底刷新
  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE 实时流（全站单例）：本页只读状态；推送到达时刷新未读（等待推送的调度在 notificationPush）。
  const stream = useNotificationStream({
    onNotification: () => refreshUnread(),
    onResync: () => refreshUnread()
  });

  // 发测试通知：默认 source=admin-debug；记录 HTTP 状态与响应体。
  // 铁律：不本地刷新未读、不插入——只等服务器 SSE 推回（到达/超时由 PushWaitResult 呈现）
  async function handleSendTest() {
    const t = title.trim();
    if (!t) {
      setCallResult({ ok: false, status: 0, body: '标题不能为空', at: Date.now() });
      return;
    }
    const payload = { level, source: 'admin-debug', title: t, body };
    const startedAt = Date.now();
    setSending(true);
    setRepulled(false);
    markWaiting(startedAt);
    try {
      const data = await createNotification(payload);
      setCallResult({ ok: true, status: 201, body: JSON.stringify(data), at: Date.now() });
      beginPushWait({ id: data && data.id, title: t, source: 'admin-debug' }, startedAt);
    } catch (err) {
      resetPushWait();
      setCallResult({
        ok: false,
        status: (err as ApiError).status || 0,
        body: (err as Error).message || '发送失败',
        at: Date.now()
      });
    } finally {
      setSending(false);
    }
  }

  // 超时后的显式动作：重新拉取（用户主动触发，允许刷新未读计数）
  function handleRepull() {
    setRepulled(true);
    refreshUnread();
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // 复制失败静默降级：选中文本便于手动复制
      try {
        const el = curlRef.current;
        if (el) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (e2) {
        // 忽略
      }
    }
  }

  const fieldColumns: TableProps<FieldRow>['columns'] = [
    {
      title: '字段',
      dataIndex: 'field',
      key: 'field',
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>
    },
    { title: '必填', dataIndex: 'required', key: 'required' },
    { title: '说明', dataIndex: 'desc', key: 'desc' }
  ];

  // 状态点映射到 antd Badge 语义色（断线用默认灰）
  const badgeStatus =
    stream.status === 'connected' ? 'success' : stream.status === 'reconnecting' ? 'warning' : 'default';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 1) 实时状态 */}
      <Card size="small" title="实时状态">
        <Space align="center" wrap size={8}>
          <Badge status={badgeStatus} />
          <Typography.Text>{notificationStreamLabel(stream, now)}</Typography.Text>
          <Typography.Text type="secondary">·</Typography.Text>
          <Typography.Text type="secondary">
            最近事件 {relativeTime(stream.lastEventAt, now)}
          </Typography.Text>
          <Typography.Text type="secondary">·</Typography.Text>
          <Typography.Text type="secondary">
            最近心跳 {relativeTime(stream.lastHeartbeatAt, now)}
          </Typography.Text>
          <Typography.Text type="secondary">·</Typography.Text>
          <Typography.Text>未读 {unread}</Typography.Text>
        </Space>
      </Card>

      {/* 2) 发一条测试通知 */}
      <Card size="small" title="发一条测试通知">
        <Form layout="vertical" onFinish={handleSendTest}>
          <Row gutter={12}>
            <Col xs={12} sm={6} md={4}>
              <Form.Item label="级别">
                <Select value={level} onChange={setLevel} options={LEVEL_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={18} md={20}>
              <Form.Item label="标题">
                <Input maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="正文">
            <Input.TextArea rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Typography.Text type="secondary">来源固定为 admin-debug</Typography.Text>
              <Button type="primary" htmlType="submit" loading={sending}>
                {sending ? '发送中…' : '发送测试通知'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
        {/* 发测试通知后的推送等待/结果（结果留到下次发送） */}
        <PushWaitResult
          state={pushState}
          onRepull={handleRepull}
          repulled={repulled}
          className="ndbg-push"
        />
      </Card>

      {/* 3) 接口说明 */}
      <Card
        size="small"
        title="接口说明"
        extra={
          <Button onClick={copyCurl}>{copied ? '已复制' : '复制 curl'}</Button>
        }
      >
        <Table<FieldRow>
          sticky={{ offsetHeader: 64 }}
          rowKey="field"
          columns={fieldColumns}
          dataSource={FIELD_ROWS}
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          鉴权：网关登录会话（浏览器内自动带 cookie）或可写 API Token（见「管理」页）。
        </Typography.Paragraph>
        <pre ref={curlRef} style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {curl}
        </pre>
      </Card>

      {/* 4) 调用结果 */}
      <Card size="small" title="调用结果">
        {callResult ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Text type={callResult.ok ? 'success' : 'danger'}>
              HTTP {callResult.status || '—'}
            </Typography.Text>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {truncate(callResult.body)}
            </pre>
          </Space>
        ) : (
          <Typography.Text type="secondary">尚无调用</Typography.Text>
        )}
      </Card>
    </Space>
  );
}
