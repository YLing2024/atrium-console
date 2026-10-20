/**
 * 「SSH 公钥」Tab：管理允许登录服务器的公钥白名单。
 *
 * 数据以服务端 `ssh_key` 表为唯一事实源，sshd 通过 AuthorizedKeysCommand 实时查询，
 * 因此停用 / 删除在下一次连接时立即生效，已建立的连接不受影响。
 *
 * props：无（面板由 `Main` 常驻挂载，只负责本 Tab 的数据与弹窗）。
 * 事件：新增 / 改标题 / 停用 / 删除均直接调用 `src/api.ts` 的接口，成功后重新拉取列表。
 * 注意：公钥只接受 `type base64 [comment]` 单行纯公钥，服务端会再次校验并拒绝前置选项。
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { createSshKey, deleteSshKey, getSshKeys, updateSshKey } from '../api';
import type { SshKey } from '../api';
import { fmtDateTime, fmtRelativeTime } from '../format';

const TITLE_MAX = 100;
const KEY_LINE_MAX = 8192;

export default function SshKeys() {
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createKey, setCreateKey] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState<SshKey | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  const [toggleTarget, setToggleTarget] = useState<SshKey | null>(null);
  const [toggling, setToggling] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SshKey | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSshKeys();
      setKeys(data.keys || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setCreateTitle('');
    setCreateKey('');
    setCreateError('');
    setCreateOpen(true);
  }

  async function submitCreate() {
    const title = createTitle.trim();
    const publicKey = createKey.trim();
    if (!title) {
      setCreateError('标题不能为空');
      return;
    }
    if (!publicKey) {
      setCreateError('公钥不能为空');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      await createSshKey({ title, public_key: publicKey });
      setCreateOpen(false);
      await load();
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(key: SshKey) {
    setEditTarget(key);
    setEditTitle(key.title);
    setEditError('');
  }

  async function submitEdit() {
    if (!editTarget || saving) return;
    const title = editTitle.trim();
    if (!title) {
      setEditError('标题不能为空');
      return;
    }
    if (title === editTarget.title) {
      setEditTarget(null);
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await updateSshKey(editTarget.id, { title });
      setEditTarget(null);
      await load();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggle() {
    if (!toggleTarget || toggling) return;
    setToggling(true);
    try {
      await updateSshKey(toggleTarget.id, { enabled: !toggleTarget.enabled });
      setToggleTarget(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      setToggleTarget(null);
    } finally {
      setToggling(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteSshKey(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const columns: TableProps<SshKey>['columns'] = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 150,
      render: (title: string) => <Typography.Text strong>{title}</Typography.Text>
    },
    {
      title: '指纹',
      dataIndex: 'fingerprint',
      key: 'fingerprint',
      width: 320,
      render: (fingerprint: string) => (
        <Typography.Text
          code
          copyable={{ text: fingerprint, tooltips: ['复制指纹', '已复制'] }}
          style={{ fontSize: 12, whiteSpace: 'nowrap' }}
        >
          {fingerprint}
        </Typography.Text>
      )
    },
    {
      title: '类型',
      dataIndex: 'keyType',
      key: 'keyType',
      width: 170,
      responsive: ['md'],
      render: (keyType: string) => <Typography.Text type="secondary">{keyType}</Typography.Text>
    },
    {
      title: '注释',
      dataIndex: 'comment',
      key: 'comment',
      width: 160,
      responsive: ['lg'],
      render: (comment: string) =>
        comment ? (
          <Typography.Text ellipsis={{ tooltip: comment }} style={{ maxWidth: 140 }}>
            {comment}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        )
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 84,
      render: (enabled: boolean) =>
        enabled ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 156,
      responsive: ['lg'],
      render: (createdAt: number) => fmtDateTime(createdAt)
    },
    {
      title: '最近使用',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      width: 112,
      responsive: ['md'],
      render: (lastUsedAt: number | null) => fmtRelativeTime(lastUsedAt)
    },
    {
      title: '操作',
      key: 'ops',
      width: 196,
      fixed: 'right',
      render: (_value, key) => (
        <Space size={0} wrap>
          <Button type="link" size="small" onClick={() => openEdit(key)}>
            改标题
          </Button>
          <Button type="link" size="small" onClick={() => setToggleTarget(key)}>
            {key.enabled ? '停用' : '启用'}
          </Button>
          <Button type="link" size="small" danger onClick={() => setDeleteTarget(key)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  const emptyState = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <Space direction="vertical" size={4}>
          <Typography.Text>还没有可登录的公钥</Typography.Text>
          <Typography.Text type="secondary">
            在本地运行 <Typography.Text code>ssh-keygen -t ed25519 -C &quot;备注&quot;</Typography.Text>
            ，把生成的 <Typography.Text code>.pub</Typography.Text> 内容粘到这里
          </Typography.Text>
        </Space>
      }
    >
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
        添加公钥
      </Button>
    </Empty>
  );

  return (
    <>
      <div className="ssh-keys">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
            <Space direction="vertical" size={2}>
              <Typography.Title level={4} style={{ margin: 0 }}>
                SSH 公钥
              </Typography.Title>
              <Typography.Text type="secondary">
                用于登录服务器的公钥。停用或删除后，下一次连接立即失效；已建立的连接不受影响。
              </Typography.Text>
            </Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              添加公钥
            </Button>
          </Space>

          {error && <Alert type="error" showIcon message={error} />}

          <Table<SshKey>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={columns}
            dataSource={keys}
            pagination={false}
            scroll={{ x: 1000 }}
            locale={{ emptyText: emptyState }}
          />
        </Space>
      </div>

      <Modal
        title="添加公钥"
        open={createOpen}
        okText="添加"
        cancelText="取消"
        onOk={submitCreate}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={creating}
        width={640}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Text strong>标题</Typography.Text>
            <Input
              value={createTitle}
              maxLength={TITLE_MAX}
              showCount
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="例如：办公笔记本"
              autoFocus
            />
          </div>
          <div>
            <Typography.Text strong>公钥</Typography.Text>
            <Input.TextArea
              value={createKey}
              maxLength={KEY_LINE_MAX}
              onChange={(e) => setCreateKey(e.target.value)}
              placeholder="ssh-ed25519 AAAA... 备注"
              autoSize={{ minRows: 4, maxRows: 8 }}
            />
            <Typography.Text type="secondary">
              粘贴整行公钥；不要带 command= 等前置选项。
            </Typography.Text>
          </div>
          {createError && <Alert type="error" showIcon message={createError} />}
        </Space>
      </Modal>

      <Modal
        title="修改标题"
        open={editTarget !== null}
        okText="保存"
        cancelText="取消"
        onOk={submitEdit}
        onCancel={() => setEditTarget(null)}
        confirmLoading={saving}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Input
            value={editTitle}
            maxLength={TITLE_MAX}
            showCount
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="公钥标题"
            autoFocus
          />
          {editError && <Alert type="error" showIcon message={editError} />}
        </Space>
      </Modal>

      <Modal
        title={toggleTarget?.enabled ? '停用公钥' : '启用公钥'}
        open={toggleTarget !== null}
        okText={toggleTarget?.enabled ? '停用' : '启用'}
        cancelText="取消"
        onOk={confirmToggle}
        onCancel={() => setToggleTarget(null)}
        confirmLoading={toggling}
      >
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          {toggleTarget?.enabled
            ? '停用后该公钥立即从 authorized_keys 消失，无法再用于新连接；可随时重新启用恢复。'
            : '启用后该公钥可用于新的登录连接。'}
        </Typography.Paragraph>
      </Modal>

      <Modal
        title="删除公钥"
        open={deleteTarget !== null}
        okText="删除"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onOk={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        confirmLoading={deleting}
      >
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          删除后该密钥立即无法登录，已建立的连接不受影响。此操作不可撤销。
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
