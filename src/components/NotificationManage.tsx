import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Col,
  Form,
  Input,
  Popover,
  Row,
  Segmented,
  Select,
  Space,
  Typography
} from 'antd';
import { createNotification, bulkDeleteNotifications, getNotificationStats } from '../api';
import type { BulkDeleteFilters } from '../api';
import { usePushWait, onNotificationPush } from '../notificationPush';
import PushWaitResult from './PushWaitResult';

/**
 * 通知管理（管理面）：发通知（compose + 推送）、批量删除 / 清空已读、统计、去重键说明。
 * - 与「通知」展示页分离：展示页只读，本页做写入与批量动作。
 * - 发通知铁律：POST 成功后不本地插入、不重拉列表、不刷统计——只等服务器 SSE 推送到达，
 *   并用 PushWaitResult 显示耗时/超时（连通性检测）。统计随推送更新。
 * - 批量删除 / 清空已读属于本地用户动作，仍就地刷新。
 */

const LEVEL_LABELS: Record<string, string> = { urgent: '紧急', normal: '常规', digest: '汇总' };

const LEVEL_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'normal', label: '常规' },
  { value: 'digest', label: '汇总' }
];

/** 通知统计（来源明细用于悬停弹层） */
interface NotifStats {
  total: number;
  unread: number;
  sources: { source: string; count: number }[];
}

export default function NotificationManage({
  onChanged,
  active = false
}: {
  onChanged?: () => void;
  active?: boolean;
}) {
  const { modal } = App.useApp();
  const [stats, setStats] = useState<NotifStats>({ total: 0, unread: 0, sources: [] });
  const [showSources, setShowSources] = useState(false);
  const [compose, setCompose] = useState({
    level: 'normal',
    source: 'admin',
    title: '',
    body: '',
    link: '',
    dedupKey: ''
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [repulled, setRepulled] = useState(false);
  const { pushState, beginPushWait, markWaiting, resetPushWait } = usePushWait();

  // 批量操作的筛选条件（无筛选 = 全部）
  const [mUnread, setMUnread] = useState(false);
  const [mLevel, setMLevel] = useState('');
  const [mSource, setMSource] = useState('');

  const onChangedRef = useRef<(() => void) | undefined>(onChanged);
  onChangedRef.current = onChanged;

  async function refreshStats() {
    try {
      const s = await getNotificationStats();
      setStats({
        total: Number(s.total) || 0,
        unread: Number(s.unread) || 0,
        sources: Array.isArray(s.sources) ? s.sources : []
      });
    } catch (e) {
      // 统计失败不打扰页面
    }
  }

  useEffect(() => {
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切到本页时刷新统计：组件常驻挂载，不刷新会看到过期数字（如别页已读/删除后）
  useEffect(() => {
    if (active) refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 统计只随服务器推送更新：SSE 推来新通知时刷新计数（发送方自己不刷，避免掩盖断链）
  useEffect(() => {
    return onNotificationPush(() => refreshStats());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 发通知：POST 成功后清空表单、只显示「已提交、等待推送」；不插入、不重拉、不刷统计
  async function handleSend() {
    const title = compose.title.trim();
    if (!title) {
      setError('标题不能为空');
      return;
    }
    const payload = {
      level: compose.level,
      source: compose.source.trim() || 'admin',
      title,
      body: compose.body,
      link: compose.link.trim(),
      dedupKey: compose.dedupKey.trim()
    };
    const startedAt = Date.now();
    setSending(true);
    setError('');
    setNotice('');
    setRepulled(false);
    markWaiting(startedAt);
    try {
      const data = await createNotification(payload);
      setCompose({ level: 'normal', source: 'admin', title: '', body: '', link: '', dedupKey: '' });
      setShowAdvanced(false);
      // 只等待服务器 SSE 推回；到达/超时由 PushWaitResult 呈现
      beginPushWait({ id: data && data.id, title, source: payload.source }, startedAt);
    } catch (err) {
      resetPushWait();
      setError((err as Error).message || '发送失败');
    } finally {
      setSending(false);
    }
  }

  // 超时后的显式动作：重新拉取列表（用户主动触发，允许刷新展示页与统计）
  function handleRepull() {
    setRepulled(true);
    refreshStats();
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- ref.current 短路调用是既有写法，保留行为不变
    onChangedRef.current && onChangedRef.current();
  }

  // 当前筛选条件 → 批量删除 body（无筛选即全部删除）
  function currentFilters(): BulkDeleteFilters {
    const f: BulkDeleteFilters = {};
    if (mLevel) f.level = mLevel;
    if (mSource) f.source = mSource;
    if (mUnread) f.unreadOnly = true;
    return f;
  }

  function describeFilters(f: BulkDeleteFilters): string {
    const parts = [];
    if (f.level) parts.push('级别 ' + (LEVEL_LABELS[f.level] || f.level));
    if (f.source) parts.push('来源 ' + f.source);
    if (f.unreadOnly) parts.push('仅未读');
    return parts.length ? `（${parts.join(' · ')}）` : '';
  }

  // 批量删除：先 dryRun 取准确条数 → 二次确认 → 再删
  async function handleBulkDelete() {
    setError('');
    setNotice('');
    const f = currentFilters();
    let count;
    try {
      const d = await bulkDeleteNotifications({ ...f, dryRun: true });
      count = Number(d.count) || 0;
    } catch (e) {
      setError((e as Error).message || '操作失败');
      return;
    }
    if (count === 0) {
      setError('当前条件下没有可删除的通知');
      return;
    }
    const scope = describeFilters(f);
    modal.confirm({
      content: `将删除${scope ? '当前筛选' + scope : '全部'}共 ${count} 条通知，删除后不可恢复。确定继续？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await bulkDeleteNotifications(f);
          setNotice(`已删除 ${count} 条通知`);
          refreshStats();
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- ref.current 短路调用是既有写法，保留行为不变
          onChangedRef.current && onChangedRef.current();
        } catch (e) {
          setError((e as Error).message || '批量删除失败');
        }
      }
    });
  }

  // 清空已读：全局删除所有已读通知，同样二次确认
  async function handleClearRead() {
    setError('');
    setNotice('');
    let count;
    try {
      const d = await bulkDeleteNotifications({ readOnly: true, dryRun: true });
      count = Number(d.count) || 0;
    } catch (e) {
      setError((e as Error).message || '操作失败');
      return;
    }
    if (count === 0) {
      setError('没有已读通知');
      return;
    }
    modal.confirm({
      content: `将清空全部已读通知，共 ${count} 条，删除后不可恢复。确定继续？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await bulkDeleteNotifications({ readOnly: true });
          setNotice(`已清空 ${count} 条已读通知`);
          refreshStats();
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- ref.current 短路调用是既有写法，保留行为不变
          onChangedRef.current && onChangedRef.current();
        } catch (e) {
          setError((e as Error).message || '清空已读失败');
        }
      }
    });
  }

  // 来源明细弹层（悬停或点击展开 Top 5）
  const sourcesContent = (
    <Space direction="vertical" size={4}>
      {stats.sources.length === 0 ? (
        <Typography.Text type="secondary">暂无来源</Typography.Text>
      ) : (
        stats.sources.slice(0, 5).map((s) => (
          <Space key={s.source} size={16} style={{ justifyContent: 'space-between', width: '100%' }}>
            <Typography.Text>{s.source}</Typography.Text>
            <Typography.Text type="secondary">{s.count}</Typography.Text>
          </Space>
        ))
      )}
    </Space>
  );

  return (
    <div className="system">
      <div className="system-head">
        <Typography.Title level={4} style={{ margin: 0 }}>
          通知管理
        </Typography.Title>
        <Popover
          content={sourcesContent}
          trigger={['hover', 'click']}
          open={showSources}
          onOpenChange={setShowSources}
        >
          <Button type="text">
            共 {stats.total} 条 · 未读 {stats.unread} · 来源 {stats.sources.length} 个
          </Button>
        </Popover>
      </div>

      {/* 发通知：字段与已验收接口一致，POST /api/admin/notifications */}
      <Form layout="vertical" onFinish={handleSend}>
        <Row gutter={12}>
          <Col xs={12} sm={6} md={4}>
            <Form.Item label="级别">
              <Select
                value={compose.level}
                onChange={(v) => setCompose({ ...compose, level: v })}
                options={LEVEL_OPTIONS}
              />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Form.Item label="来源">
              <Input
                maxLength={40}
                placeholder="admin"
                value={compose.source}
                onChange={(e) => setCompose({ ...compose, source: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10} md={16}>
            <Form.Item label="标题">
              <Input
                required
                maxLength={80}
                placeholder="给你自己看的通知"
                value={compose.title}
                onChange={(e) => setCompose({ ...compose, title: e.target.value })}
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="正文（选填，纯文本）">
          <Input.TextArea
            rows={3}
            value={compose.body}
            onChange={(e) => setCompose({ ...compose, body: e.target.value })}
          />
        </Form.Item>
        <Row gutter={12} align="bottom">
          <Col xs={24} md={20}>
            <Form.Item label="链接（选填）">
              <Input
                type="url"
                placeholder="https://…"
                value={compose.link}
                onChange={(e) => setCompose({ ...compose, link: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={4}>
            <Form.Item>
              <Button type="link" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? '收起高级' : '高级'}
              </Button>
            </Form.Item>
          </Col>
        </Row>
        {showAdvanced && (
          <Form.Item label="去重键（选填）">
            <Input
              maxLength={200}
              placeholder="10 分钟内相同去重键只保留一条"
              value={compose.dedupKey}
              onChange={(e) => setCompose({ ...compose, dedupKey: e.target.value })}
            />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0 }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text type="secondary">发送后会同步推送到 App</Typography.Text>
            <Button type="primary" htmlType="submit" loading={sending}>
              {sending ? '发送中…' : '发送'}
            </Button>
          </Space>
        </Form.Item>
      </Form>

      {/* 发通知后的推送等待/结果（只经服务器 SSE 进入列表；结果留到下次发送） */}
      <PushWaitResult
        state={pushState}
        onRepull={handleRepull}
        repulled={repulled}
        className="notif-push"
      />

      {/* 去重键说明（克制一行） */}
      <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
        去重键：同一去重键 10 分钟内只保留一条，重复提交会更新原通知内容并重新置为未读。
      </Typography.Paragraph>

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
          value={mUnread ? 'unread' : 'all'}
          onChange={(v) => setMUnread(v === 'unread')}
          options={[
            { label: '全部', value: 'all' },
            { label: '未读', value: 'unread' }
          ]}
        />
        <Select
          value={mLevel}
          onChange={setMLevel}
          options={[{ value: '', label: '全部级别' }, ...LEVEL_OPTIONS]}
          style={{ minWidth: 120 }}
        />
        <Select
          value={mSource}
          onChange={setMSource}
          options={[
            { value: '', label: '全部来源' },
            ...stats.sources.map((s) => ({ value: s.source, label: s.source }))
          ]}
          style={{ minWidth: 120 }}
        />
        <Space style={{ marginLeft: 'auto' }}>
          <Button onClick={handleClearRead}>清空已读</Button>
          <Button danger onClick={handleBulkDelete}>
            批量删除
          </Button>
        </Space>
      </div>

      {notice && <Alert type="success" showIcon message={notice} style={{ marginBottom: 12 }} />}
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
    </div>
  );
}
