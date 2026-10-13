import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd';
import type { TableProps } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import {
  getSessions,
  renameSession,
  deleteSession,
  getApiTokens,
  createApiToken,
  updateApiToken,
  deleteApiToken,
  logout
} from '../api';
import type { ApiToken, SessionInfo, UpdateApiTokenInput } from '../api';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function remainingDays(expiresAt: number): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 86400000));
}

function relativeTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

export default function Manage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const renameInFlight = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ===== 接口令牌状态 =====
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createNote, setCreateNote] = useState('');
  const [createDays, setCreateDays] = useState('30');
  const [createCustomDays, setCreateCustomDays] = useState('');
  const [createCanWrite, setCreateCanWrite] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdToken, setCreatedToken] = useState<{ token: string; curl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiToken | null>(null);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDays, setEditDays] = useState('');
  const [editCanWrite, setEditCanWrite] = useState(false);
  const [apiEditSaving, setApiEditSaving] = useState(false);
  const [apiEditError, setApiEditError] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSessions();
      setSessions(data.sessions || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTokens = useCallback(async () => {
    setApiLoading(true);
    setApiError('');
    try {
      const data = await getApiTokens();
      setApiTokens(data.tokens || []);
    } catch (e) {
      setApiError((e as Error).message);
    } finally {
      setApiLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadTokens();
  }, [load, loadTokens]);

  function startRename(s: SessionInfo) {
    setEditingId(s.id);
    setEditValue(s.deviceName || '');
    setEditError('');
  }

  function cancelRename() {
    setEditingId(null);
    setEditValue('');
    setEditError('');
  }

  async function saveRename(s: SessionInfo) {
    const name = editValue.trim();
    if (!name) {
      setEditError('设备名称不能为空');
      return;
    }
    if (name === (s.deviceName || '')) {
      cancelRename(); // 未改动：直接退出编辑态，不发请求
      return;
    }
    if (renameInFlight.current) return; // onBlur 与「保存」点击同帧触发时去重
    renameInFlight.current = true;
    setEditSaving(true);
    setEditError('');
    try {
      await renameSession(s.id, name);
      setSessions((list) => list.map((x) => (x.id === s.id ? { ...x, deviceName: name } : x)));
      cancelRename();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      renameInFlight.current = false;
      setEditSaving(false);
    }
  }

  function onEditKeyDown(s: SessionInfo) {
    return (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') saveRename(s);
      else if (e.key === 'Escape') e.currentTarget.blur(); // 失焦触发自动保存，等价保存、避免丢输入
    };
  }

  function askDelete(s: SessionInfo) {
    setDeleteTarget(s);
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteSession(deleteTarget.id);
      if (deleteTarget.isCurrent) {
        // 删除当前设备：撤销自身凭证 → 退出网关会话重新登录
        logout();
        return;
      }
      setSessions((list) => list.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError((e as Error).message);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  // ===== 接口令牌操作 =====

  function openCreate() {
    setCreateName('');
    setCreateNote('');
    setCreateDays('30');
    setCreateCustomDays('');
    setCreateCanWrite(false);
    setCreateError('');
    setShowCreate(true);
  }

  function resolveDays() {
    if (createDays === 'custom') {
      const n = parseInt(createCustomDays, 10);
      if (!Number.isInteger(n) || n < 1 || n > 365) return null;
      return n;
    }
    const n = parseInt(createDays, 10);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
  }

  async function submitCreate() {
    const name = createName.trim();
    if (!name) {
      setCreateError('令牌名称不能为空');
      return;
    }
    const days = resolveDays();
    if (!days) {
      setCreateError('有效期需为 1~365 天的整数');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const data = await createApiToken({ name, note: createNote.trim(), expiresInDays: days, canWrite: createCanWrite });
      setCreatedToken({
        token: data.token,
        curl: `curl -H "Authorization: Bearer ${data.token}" ${location.origin}/api/admin/system`
      });
      setShowCreate(false);
      await loadTokens();
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function copyToken(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function openEdit(t: ApiToken) {
    setEditTarget(t);
    setEditName(t.name || '');
    setEditNote(t.note || '');
    setEditDays('');
    setEditCanWrite(t.canWrite === true);
    setEditError('');
  }

  async function submitEdit() {
    if (!editTarget || apiEditSaving) return;
    const name = editName.trim();
    if (!name) {
      setApiEditError('令牌名称不能为空');
      return;
    }
    const patch: UpdateApiTokenInput = {};
    if (name !== (editTarget.name || '')) patch.name = name;
    if (editNote.trim() !== (editTarget.note || '')) patch.note = editNote.trim();
    if (editCanWrite !== (editTarget.canWrite === true)) patch.canWrite = editCanWrite;
    if (editDays) {
      const n = parseInt(editDays, 10);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        setApiEditError('有效期需为 1~365 天的整数');
        return;
      }
      patch.expiresInDays = n;
    }
    if (!Object.keys(patch).length) {
      setEditTarget(null); // 无改动：直接关闭
      return;
    }
    setApiEditSaving(true);
    setApiEditError('');
    try {
      await updateApiToken(editTarget.id, patch);
      setEditTarget(null);
      await loadTokens();
    } catch (e) {
      setApiEditError((e as Error).message);
    } finally {
      setApiEditSaving(false);
    }
  }

  function askRevoke(t: ApiToken) {
    setRevokeTarget(t);
  }

  async function confirmRevoke() {
    if (!revokeTarget || revoking) return;
    setRevoking(true);
    try {
      await deleteApiToken(revokeTarget.id);
      setApiTokens((list) => list.filter((x) => x.id !== revokeTarget.id));
      setRevokeTarget(null);
    } catch (e) {
      setApiError((e as Error).message);
      setRevokeTarget(null);
    } finally {
      setRevoking(false);
    }
  }

  const sessionColumns: TableProps<SessionInfo>['columns'] = [
    {
      title: '设备',
      key: 'device',
      render: (_value, s) => {
        const editing = editingId === s.id;
        if (editing) {
          return (
            <Space direction="vertical" size={4} style={{ maxWidth: 260 }}>
              <Input
                value={editValue}
                maxLength={64}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={onEditKeyDown(s)}
                onBlur={() => saveRename(s)}
                disabled={editSaving}
                placeholder="设备名称"
                autoFocus
              />
              {editError && <Typography.Text type="danger">{editError}</Typography.Text>}
            </Space>
          );
        }
        return (
          <Space direction="vertical" size={2}>
            <Space size={8} wrap>
              <Typography.Text strong>{s.deviceName || '未命名设备'}</Typography.Text>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => startRename(s)}
                title="重命名设备"
                aria-label="重命名设备"
              />
              {s.isCurrent && <Tag>当前设备</Tag>}
            </Space>
            {s.userAgent && (
              <Typography.Text type="secondary" ellipsis={{ tooltip: s.userAgent }}>
                {s.userAgent}
              </Typography.Text>
            )}
          </Space>
        );
      }
    },
    { title: '设备 IP', dataIndex: 'ip', key: 'ip', render: (ip: string) => ip || '—' },
    {
      title: '登录地点',
      key: 'location',
      render: (_value, s) => (s.isLocal ? '本地网络' : s.location || '—')
    },
    { title: '登录时间', key: 'createdAt', render: (_value, s) => formatTime(s.createdAt) },
    { title: '最近活跃', key: 'lastSeenAt', render: (_value, s) => relativeTime(s.lastSeenAt) },
    { title: '凭证过期', key: 'expiresAt', render: (_value, s) => formatTime(s.expiresAt * 1000) },
    {
      title: '操作',
      key: 'ops',
      width: 120,
      render: (_value, s) => {
        if (editingId === s.id) {
          return (
            <Button type="link" size="small" onClick={() => saveRename(s)} disabled={editSaving}>
              保存
            </Button>
          );
        }
        return (
          <Button type="link" size="small" danger onClick={() => askDelete(s)}>
            删除
          </Button>
        );
      }
    }
  ];

  const tokenColumns: TableProps<ApiToken>['columns'] = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      render: (note: string | undefined) => note || '—'
    },
    {
      title: '权限',
      key: 'perm',
      render: (_value, t) => <Tag>{t.canWrite ? '可写' : '只读'}</Tag>
    },
    { title: '创建时间', key: 'createdAt', render: (_value, t) => formatDate(t.createdAt) },
    {
      title: '过期时间',
      key: 'expiresAt',
      render: (_value, t) => {
        const expired = t.expiresAt > 0 && t.expiresAt <= Date.now();
        if (expired) return <Typography.Text type="danger">已过期</Typography.Text>;
        return (
          <span>
            {formatDate(t.expiresAt)} · 剩余 {remainingDays(t.expiresAt)} 天
          </span>
        );
      }
    },
    {
      title: '最近使用',
      key: 'lastUsedAt',
      render: (_value, t) =>
        t.lastUsedAt ? (
          formatTime(t.lastUsedAt)
        ) : (
          <Typography.Text type="secondary">从未使用</Typography.Text>
        )
    },
    {
      title: '操作',
      key: 'ops',
      width: 120,
      render: (_value, t) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openEdit(t)}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => askRevoke(t)}>
            吊销
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div className="system">
      <div className="system-head">
        <Typography.Title level={4} style={{ margin: 0 }}>
          设备管理
        </Typography.Title>
        <Button onClick={load} loading={loading}>
          {loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      <Typography.Paragraph type="secondary">
        删除设备会撤销其登录凭证，该设备必须重新认证才能进入管理后台。
      </Typography.Paragraph>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      <Table<SessionInfo>
        rowKey="id"
        columns={sessionColumns}
        dataSource={sessions}
        loading={loading}
        pagination={false}
        locale={{ emptyText: loading ? '加载中…' : '暂无已登录设备' }}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title="删除设备"
        open={deleteTarget !== null}
        onOk={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
        okText={deleting ? '删除中…' : '删除'}
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
        maskClosable={!deleting}
      >
        {deleteTarget && (
          <Space direction="vertical" size={8}>
            <Typography.Paragraph style={{ margin: 0 }}>
              删除设备「{deleteTarget.deviceName || '未命名设备'}」并撤销其登录凭证？
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {deleteTarget.isCurrent
                ? '该设备将立即退出，必须重新认证才能进入管理后台。'
                : '该设备将立即失效，必须重新 TOTP 认证后才能进入管理后台。'}
            </Typography.Paragraph>
          </Space>
        )}
      </Modal>

      {/* ============ 接口令牌区块（与设备管理视觉隔离，独立表格） ============ */}
      <div className="system-head" style={{ marginTop: 40 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          接口令牌
        </Typography.Title>
        <Button onClick={openCreate} disabled={creating}>
          生成令牌
        </Button>
      </div>

      <Typography.Paragraph type="secondary">
        接口令牌用于第三方工具调用 Admin 接口。调用时在请求头携带{' '}
        <Typography.Text code>Authorization: Bearer &lt;令牌&gt;</Typography.Text> 即可。
        令牌与登录设备相互独立，不占用设备登录。请妥善保管令牌，泄露可随时吊销。
        标记为「只读」的令牌只能读取；需要调用写入接口（如发通知）请在创建时勾选「允许写入」。
      </Typography.Paragraph>

      {apiError && <Alert type="error" showIcon message={apiError} style={{ marginBottom: 16 }} />}

      <Table<ApiToken>
        rowKey="id"
        columns={tokenColumns}
        dataSource={apiTokens}
        loading={apiLoading}
        pagination={false}
        locale={{ emptyText: apiLoading ? '加载中…' : '暂无接口令牌' }}
        scroll={{ x: 'max-content' }}
      />

      {/* 生成令牌弹窗 */}
      <Modal
        title="生成接口令牌"
        open={showCreate}
        onOk={submitCreate}
        onCancel={() => !creating && setShowCreate(false)}
        okText={creating ? '生成中…' : '生成'}
        cancelText="取消"
        confirmLoading={creating}
        maskClosable={!creating}
      >
        <Form layout="vertical">
          <Form.Item label="令牌名称">
            <Input
              value={createName}
              maxLength={64}
              placeholder="如：行情脚本"
              onChange={(e) => setCreateName(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="备注（选填）">
            <Input
              value={createNote}
              maxLength={200}
              placeholder="用途说明"
              onChange={(e) => setCreateNote(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="有效期">
            <Select
              value={createDays}
              onChange={(v) => setCreateDays(v)}
              options={[
                { value: '7', label: '7 天' },
                { value: '30', label: '30 天' },
                { value: '90', label: '90 天' },
                { value: 'custom', label: '自定义天数' }
              ]}
            />
          </Form.Item>
          {createDays === 'custom' && (
            <Form.Item>
              <Input
                type="number"
                min={1}
                max={365}
                placeholder="1~365"
                value={createCustomDays}
                onChange={(e) => setCreateCustomDays(e.target.value)}
              />
            </Form.Item>
          )}
          <Form.Item>
            <Checkbox
              checked={createCanWrite}
              onChange={(e) => setCreateCanWrite(e.target.checked)}
            >
              允许写入（可调用发通知等写入接口）
            </Checkbox>
          </Form.Item>
        </Form>
        {createError && <Alert type="error" showIcon message={createError} />}
      </Modal>

      {/* 令牌展示弹窗（明文仅此一次） */}
      <Modal
        title="接口令牌已生成"
        open={createdToken !== null}
        onCancel={() => setCreatedToken(null)}
        footer={
          <Button onClick={() => setCreatedToken(null)}>关闭</Button>
        }
      >
        {createdToken && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              令牌仅显示一次，关闭后无法再次查看，请立即保存。
            </Typography.Paragraph>
            <Typography.Paragraph code style={{ margin: 0, wordBreak: 'break-all' }}>
              {createdToken.token}
            </Typography.Paragraph>
            <Button type="primary" onClick={() => copyToken(createdToken.token)}>
              {copied ? '已复制' : '复制令牌'}
            </Button>
            <Typography.Text type="secondary">curl 用法示例</Typography.Text>
            <Typography.Paragraph code style={{ margin: 0, wordBreak: 'break-all' }}>
              {createdToken.curl}
            </Typography.Paragraph>
          </Space>
        )}
      </Modal>

      {/* 编辑令牌弹窗 */}
      <Modal
        title="编辑接口令牌"
        open={editTarget !== null}
        onOk={submitEdit}
        onCancel={() => !apiEditSaving && setEditTarget(null)}
        okText={apiEditSaving ? '保存中…' : '保存'}
        cancelText="取消"
        confirmLoading={apiEditSaving}
        maskClosable={!apiEditSaving}
      >
        <Form layout="vertical">
          <Form.Item label="令牌名称">
            <Input
              value={editName}
              maxLength={64}
              onChange={(e) => setEditName(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="备注（选填）">
            <Input
              value={editNote}
              maxLength={200}
              placeholder="用途说明"
              onChange={(e) => setEditNote(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="重置有效期（选填）">
            <Input
              type="number"
              min={1}
              max={365}
              placeholder="留空则保持当前有效期"
              value={editDays}
              onChange={(e) => setEditDays(e.target.value)}
            />
          </Form.Item>
          <Form.Item>
            <Checkbox checked={editCanWrite} onChange={(e) => setEditCanWrite(e.target.checked)}>
              允许写入（可调用发通知等写入接口）
            </Checkbox>
          </Form.Item>
        </Form>
        {apiEditError && <Alert type="error" showIcon message={apiEditError} />}
      </Modal>

      {/* 吊销确认弹窗 */}
      <Modal
        title="吊销接口令牌"
        open={revokeTarget !== null}
        onOk={confirmRevoke}
        onCancel={() => !revoking && setRevokeTarget(null)}
        okText={revoking ? '吊销中…' : '吊销'}
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={revoking}
        maskClosable={!revoking}
      >
        {revokeTarget && (
          <Typography.Paragraph style={{ margin: 0 }}>
            吊销令牌「{revokeTarget.name}」？吊销后立即失效，使用该令牌的工具将无法再调用接口。
          </Typography.Paragraph>
        )}
      </Modal>
    </div>
  );
}
