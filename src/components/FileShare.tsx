import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Typography
} from 'antd';
import type { TableProps } from 'antd';
import { createFileShare, listFileShares, updateFileShare, deleteFileShare } from '../api';
import type { FileShare, FileShareCreateBody, FileSharePatch } from '../api';

/**
 * 文件区「临时链接」：创建限时下载链接 + 管理面板。
 * 语义对齐 v2link：expiresAt === 0 为永久有效；状态机 active → expired | revoked，
 * revoked 不可逆；改期改的是过期时刻本身（datetime-local，分钟精度）。
 * 链接地址一律用后端返回的 url，前端不拼域名。
 */

const HOUR = 3600 * 1000;

// 预设有效期：hours 为 0 表示永久，为 null 表示自定义时刻
const PRESETS = [
  { key: '1h', label: '1 小时', hours: 1 },
  { key: '24h', label: '24 小时', hours: 24 },
  { key: '7d', label: '7 天', hours: 168 },
  { key: '30d', label: '30 天', hours: 720 },
  { key: 'forever', label: '永久', hours: 0 },
  { key: 'custom', label: '自定义', hours: null }
];

const STATUS_TEXT = { active: '有效', expired: '已过期', revoked: '已撤销' };
const STATUS_BADGE: Record<FileShare['status'], 'success' | 'warning' | 'error'> = {
  active: 'success',
  expired: 'warning',
  revoked: 'error'
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// ms → datetime-local 值（本地时间，分钟精度）
function toDateTimeLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

// datetime-local 值 → ms（按本地时间解析；空 / 非法返回 null）
function toEpochMs(s: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function fmtTime(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

// 毫秒时长 → 「x 天 x 小时 / x 小时 x 分 / x 分」
function humanDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${mins} 分`;
  return `${Math.max(1, mins)} 分`;
}

// 列表里的有效期文案：永久 / 剩余 x / 已过期 / 已撤销
function expiryText(s: FileShare): string {
  if (s.status === 'revoked') return '已撤销';
  if (s.expiresAt === 0) return '永久';
  if (s.remainingMs > 0) return `剩余 ${humanDuration(s.remainingMs)}`;
  return '已过期';
}

// 剪贴板不可用时回退 window.prompt（与 v2link CopyModal 一致）
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    window.prompt('复制链接', text);
    return false;
  }
}

/* ---------------- 创建：预设有效期 + 自定义时刻 ---------------- */

export function ShareCreateModal({
  target,
  name,
  onClose
}: {
  target: string;
  name: string;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState('24h');
  const [customAt, setCustomAt] = useState(() => toDateTimeLocal(Date.now() + 24 * HOUR));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<FileShare | null>(null);
  const [copied, setCopied] = useState(false);

  function buildBody(): FileShareCreateBody {
    if (preset === 'forever') return { expiresAt: 0 };
    if (preset === 'custom') {
      const ms = toEpochMs(customAt);
      if (ms === null) throw new Error('请选择过期时间');
      if (ms <= Date.now()) throw new Error('过期时间须晚于当前时间');
      return { expiresAt: ms };
    }
    const p = PRESETS.find((x) => x.key === preset) || PRESETS[1];
    // 走到这里 preset 必为固定档位（forever / custom 已在上方返回），hours 一定是数字
    return { ttlHours: p.hours as number };
  }

  async function submit() {
    if (result) return; // 已出结果：回车不再重复创建
    setErr('');
    let body: FileShareCreateBody;
    try {
      body = buildBody();
    } catch (e2) {
      setErr((e2 as Error).message);
      return;
    }
    setBusy(true);
    try {
      const data = await createFileShare(target, {
        ...body,
        ...(note.trim() ? { note: note.trim() } : {})
      });
      const rec = data && data.share ? data.share : data;
      if (!rec || !rec.url) {
        setErr('创建成功，但未返回链接');
      } else {
        setResult(rec);
      }
    } catch (e2) {
      setErr((e2 as Error).message || '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    const ok = await copyText(result!.url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <Modal
      title="创建临时链接"
      open
      onCancel={() => !busy && onClose()}
      maskClosable={!busy}
      destroyOnHidden
      footer={
        result ? (
          <Space>
            <Button onClick={onClose}>完成</Button>
            <Button type="primary" onClick={copy}>
              {copied ? '已复制' : '复制链接'}
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button type="primary" loading={busy} onClick={submit}>
              {busy ? '创建中…' : '创建链接'}
            </Button>
          </Space>
        )
      }
    >
      <Typography.Text ellipsis title={name} style={{ display: 'block', marginBottom: 12 }}>
        {name}
      </Typography.Text>

      {result ? (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text>链接</Typography.Text>
          <Input
            readOnly
            value={result.url}
            onFocus={(e) => e.target.select()}
          />
          <Typography.Text type="secondary">
            {result.expiresAt === 0
              ? '永久有效，不会自动过期，只能手动撤销。'
              : `有效期至 ${fmtTime(result.expiresAt)}`}
          </Typography.Text>
        </Space>
      ) : (
        <Form layout="vertical" onFinish={submit} style={{ marginTop: 12 }}>
          <Form.Item label="有效期">
            <Select
              value={preset}
              onChange={setPreset}
              options={PRESETS.map((p) => ({ value: p.key, label: p.label }))}
            />
          </Form.Item>

          {preset === 'custom' && (
            <Form.Item label="过期时间（本地时间）">
              <Input
                type="datetime-local"
                value={customAt}
                onChange={(e) => setCustomAt(e.target.value)}
              />
            </Form.Item>
          )}

          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            {preset === 'forever'
              ? '永久有效，不会自动过期，只能手动撤销。'
              : '到期后链接自动失效。'}
          </Typography.Paragraph>

          <Form.Item label="备注">
            <Input
              value={note}
              maxLength={80}
              onChange={(e) => setNote(e.target.value)}
              placeholder="选填"
            />
          </Form.Item>
        </Form>
      )}

      {err && <Alert type="error" showIcon message={err} />}
    </Modal>
  );
}

/* ---------------- 改期：改过期时刻本身（转永久 = expiresAt 0） ---------------- */

function ShareScheduleModal({
  share,
  onClose,
  onDone
}: {
  share: FileShare;
  onClose: () => void;
  onDone: (s: FileShare) => void;
}) {
  const permanent = share.expiresAt === 0;
  const [mode, setMode] = useState('finite');
  const [absInput, setAbsInput] = useState(permanent ? '' : toDateTimeLocal(share.expiresAt));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const hint = useMemo(() => {
    if (mode === 'permanent') {
      return permanent
        ? '当前为永久有效，不会自动过期。'
        : '转为永久后不再自动过期，需手动撤销；之后可随时再指定过期时间。';
    }
    const ms = toEpochMs(absInput);
    if (ms === null) return permanent ? '当前为永久有效：选择过期时间即转为限时。' : '';
    const diff = ms - Date.now();
    if (diff <= 0) return '该时刻已过去，请选择未来时间';
    const tip = `距现在约 ${humanDuration(diff)}`;
    return !permanent && ms < share.expiresAt
      ? `${tip}（比当前到期时间早，将缩短有效期）`
      : tip;
  }, [absInput, mode, permanent, share.expiresAt]);

  async function submit() {
    setErr('');
    if (mode === 'permanent') {
      if (!window.confirm('转为永久有效后不再自动过期，只能手动撤销。确认？')) return;
      await doSubmit({ expiresAt: 0 });
      return;
    }
    const ms = toEpochMs(absInput);
    if (ms === null) {
      setErr('请选择过期时间');
      return;
    }
    if (ms <= Date.now()) {
      setErr('过期时间须晚于当前时间');
      return;
    }
    // 缩短有效期 → 二次确认（语义上是有意义的操作，但容易误点）
    if (!permanent && ms < share.expiresAt) {
      if (!window.confirm('新的过期时间早于当前，将缩短有效期。确认？')) return;
    }
    await doSubmit({ expiresAt: ms });
  }

  async function doSubmit(body: FileSharePatch) {
    setBusy(true);
    try {
      const data = await updateFileShare(share.id, body);
      onDone(data && data.share ? data.share : data);
      onClose();
    } catch (e2) {
      setErr((e2 as Error).message || '操作失败');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="改期"
      open
      onCancel={() => !busy && onClose()}
      maskClosable={!busy}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="primary" loading={busy} onClick={submit}>
            {busy ? '提交中…' : '确定'}
          </Button>
        </Space>
      }
    >
      <Typography.Text ellipsis title={share.relPath} style={{ display: 'block', marginBottom: 12 }}>
        {share.relPath}
      </Typography.Text>

      <Form layout="vertical">
        {!permanent && (
          <Form.Item label="方式">
            <Segmented
              value={mode}
              onChange={(v) => {
                const next = String(v);
                setMode(next);
                if (next === 'finite') setAbsInput(toDateTimeLocal(share.expiresAt));
              }}
              options={[
                { label: '指定时刻', value: 'finite' },
                { label: '转为永久', value: 'permanent' }
              ]}
            />
          </Form.Item>
        )}

        {mode === 'finite' && (
          <Form.Item label="过期时间（本地时间）">
            <Input
              type="datetime-local"
              value={absInput}
              autoFocus
              onChange={(e) => setAbsInput(e.target.value)}
            />
          </Form.Item>
        )}

        {hint && <Typography.Paragraph type="secondary">{hint}</Typography.Paragraph>}
      </Form>

      {err && <Alert type="error" showIcon message={err} />}
    </Modal>
  );
}

/* ---------------- 管理面板：列表 / 复制 / 改期 / 撤销 / 删除 ---------------- */

export function ShareManageModal({ onClose }: { onClose: () => void }) {
  const [shares, setShares] = useState<FileShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState('');
  const [editing, setEditing] = useState<FileShare | null>(null);
  const [copiedId, setCopiedId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await listFileShares();
      const list: FileShare[] = data && data.shares ? data.shares : Array.isArray(data) ? data : [];
      setShares(list);
    } catch (e) {
      setErr((e as Error).message || '读取失败');
      setShares([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function applyUpdate(updated: FileShare): void {
    if (!updated || !updated.id) return;
    setShares((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  async function copy(s: FileShare) {
    const ok = await copyText(s.url);
    if (ok) {
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(''), 1500);
    }
  }

  async function revoke(s: FileShare) {
    setBusyId(s.id);
    try {
      const data = await updateFileShare(s.id, { revoked: true });
      applyUpdate(data && data.share ? data.share : data);
    } catch (e) {
      window.alert((e as Error).message || '撤销失败');
    } finally {
      setBusyId('');
    }
  }

  async function remove(s: FileShare) {
    setBusyId(s.id);
    try {
      await deleteFileShare(s.id);
      setShares((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      window.alert((e as Error).message || '删除失败');
    } finally {
      setBusyId('');
    }
  }

  const columns: TableProps<FileShare>['columns'] = [
    {
      title: '文件',
      dataIndex: 'relPath',
      key: 'relPath',
      render: (relPath: string) => (
        <Typography.Text ellipsis title={relPath} style={{ maxWidth: 260 }}>
          {relPath}
        </Typography.Text>
      )
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_value, s) => (
        <Badge status={STATUS_BADGE[s.status] || 'default'} text={STATUS_TEXT[s.status] || s.status} />
      )
    },
    {
      title: '有效期',
      key: 'expiry',
      width: 150,
      render: (_value, s) => (
        <Typography.Text type="secondary" title={s.expiresAt ? fmtTime(s.expiresAt) : ''}>
          {expiryText(s)}
        </Typography.Text>
      )
    },
    {
      title: '下载',
      dataIndex: 'downloads',
      key: 'downloads',
      width: 80,
      render: (downloads: number | undefined) => downloads || 0
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (createdAt: number) => fmtTime(createdAt)
    },
    {
      title: '文件',
      key: 'fileExists',
      width: 80,
      render: (_value, s) => (
        <Typography.Text type={s.fileExists ? undefined : 'danger'}>
          {s.fileExists ? '在' : '已删除'}
        </Typography.Text>
      )
    },
    {
      title: '',
      key: 'ops',
      width: 280,
      render: (_value, s) => (
        <Space size={0} wrap={false}>
          <Button type="link" size="small" onClick={() => copy(s)}>
            {copiedId === s.id ? '已复制' : '复制链接'}
          </Button>
          {s.status === 'active' && (
            <Button type="link" size="small" onClick={() => setEditing(s)}>
              改期
            </Button>
          )}
          {s.status === 'active' && (
            <Popconfirm
              title={`撤销「${s.relPath}」的链接？撤销后不可恢复。`}
              okText="撤销"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => revoke(s)}
            >
              <Button type="link" size="small" danger disabled={busyId === s.id}>
                撤销
              </Button>
            </Popconfirm>
          )}
          <Popconfirm
            title={`删除「${s.relPath}」的链接记录？磁盘文件不受影响。`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove(s)}
          >
            <Button type="link" size="small" danger disabled={busyId === s.id}>
              删除记录
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      <Modal
        title="临时链接"
        open
        width={960}
        onCancel={onClose}
        maskClosable
        destroyOnHidden
        footer={
          <Button onClick={onClose}>
            关闭
          </Button>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button size="small" onClick={load} loading={loading}>
            刷新
          </Button>
        </div>

        {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 8 }} />}

        <Table<FileShare>
          rowKey="id"
          columns={columns}
          dataSource={shares}
          loading={{ spinning: loading, tip: '加载中…' }}
          pagination={false}
          locale={{ emptyText: '暂无临时链接' }}
          scroll={{ x: 'max-content' }}
        />
      </Modal>

      {editing && (
        <ShareScheduleModal
          share={editing}
          onClose={() => setEditing(null)}
          onDone={applyUpdate}
        />
      )}
    </>
  );
}
