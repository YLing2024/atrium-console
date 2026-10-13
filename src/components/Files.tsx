import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent
} from 'react';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Table,
  Typography,
  Upload
} from 'antd';
import type { TableProps, UploadProps } from 'antd';
import { FileOutlined, FolderOutlined } from '@ant-design/icons';
import {
  listFiles,
  makeDir,
  renameEntry,
  deleteEntry,
  fileDownloadUrl,
  uploadFileTo
} from '../api';
import type { FileEntry } from '../api';
import { extOf, fmtSize } from '../format';
import { ShareCreateModal, ShareManageModal } from './FileShare';

/**
 * 文件区：目录浏览 / 拖拽上传（带进度条）/ 新建文件夹 / 重命名 / 删除 / 下载。
 * 路径均为相对文件区根目录的相对路径，越界由后端拦截。
 *
 * 根目录两类保护语义完全由后端负责，前端不做任何额外过滤或禁用：
 *  · 隐身（protected）的根项后端不返回 → 列表里看不到；
 *  · 只读（readonly）的根项后端照常返回、可见，写入被后端 403 拒绝 → 前端照原样提示后端错误。
 */

const ROOT = '';

/** 上传队列项（进度 / 状态 / 速率） */
interface UploadItem {
  id: string;
  name: string;
  size: number;
  loaded: number;
  percent: number;
  speed: number;
  eta: number;
  status: 'waiting' | 'uploading' | 'done' | 'error';
  error: string;
}

/** 待上传项：文件 + 相对当前目录的子路径（拖入文件夹时保留结构） */
interface UploadInput {
  file: File;
  dir: string;
}

/** 上传任务（入队项，pump 串行消费） */
interface UploadJob {
  id: string;
  file: File;
  size: number;
  target: string;
}

/** 新建 / 重命名 弹窗状态 */
interface DialogState {
  type: 'mkdir' | 'rename';
  target: string;
  value: string;
  title: string;
}

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${Math.ceil(sec)} 秒`;
  return `${Math.floor(sec / 60)} 分 ${Math.ceil(sec % 60)} 秒`;
}

// 上传行的状态文案。
// 注意：XHR 进度只反映「浏览器 → nginx」这一段；字节发完后服务端还要
// nginx 缓冲落盘 → 转发后端 → 后端写成正式文件（大文件可达数秒）。
// 那段时间百分比会停在 99% 不动，必须给明确状态，否则看起来像卡死。
function uploadMeta(u: UploadItem): string {
  if (u.status === 'error') return u.error;
  if (u.status === 'done') return `${fmtSize(u.size)} · 完成`;
  if (u.percent >= 99) return `${fmtSize(u.size)} · 写入服务器…`;
  const parts = [`${fmtSize(u.loaded)} / ${fmtSize(u.size)}`, `${u.percent.toFixed(0)}%`];
  if (u.speed) parts.push(`${fmtSize(u.speed)}/s`);
  if (u.eta) parts.push(`剩余 ${fmtDuration(u.eta)}`);
  return parts.join(' · ');
}

// 递归读取拖入的目录条目（DataTransfer 的 webkitGetAsEntry）
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = [];
    const next = () => {
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(out);
        out.push(...batch);
        return next();
      }, reject);
    };
    next();
  });
}

// 把目录条目展开成 [{ file, dir }]；dir 为相对被拖入目录的上级路径
async function walkEntry(entry: FileSystemEntry, dir: string, acc: UploadInput[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) =>
      (entry as FileSystemFileEntry).file(res, rej)
    );
    acc.push({ file, dir });
    return;
  }
  if (entry.isDirectory) {
    const sub = dir ? `${dir}/${entry.name}` : entry.name;
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const c of children) {
      // eslint-disable-next-line no-await-in-loop
      await walkEntry(c, sub, acc);
    }
  }
}

export default function Files({ active }: { active: boolean }) {
  const [path, setPath] = useState(ROOT);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState<{ key: 'name' | 'size' | 'time'; dir: number }>({
    key: 'name',
    dir: 1
  });
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogErr, setDialogErr] = useState('');
  const [shareTarget, setShareTarget] = useState<{ target: string; name: string } | null>(null); // { target, name } 创建临时链接
  const [sharePanel, setSharePanel] = useState(false); // 临时链接管理面板

  const loadedOnce = useRef(false);
  const pendingRef = useRef<UploadJob[]>([]);
  const runningRef = useRef(false);
  const pathRef = useRef(ROOT);
  // 拖拽落入 Dragger 时，rc-upload 会同步读 dataTransfer.files（文件夹会被拍平）；
  // 用守卫让 beforeUpload 只负责「点选文件」，拖拽一律交给容器的递归展开，避免重复入队。
  const dropGuardRef = useRef(false);

  pathRef.current = path;

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setErr('');
    try {
      const data = await listFiles(p);
      setEntries(data.entries || []);
      setPath(data.path || '');
    } catch (e) {
      setErr((e as Error).message || '读取失败');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 懒加载：Tab 首次显示时才请求
  useEffect(() => {
    if (active && !loadedOnce.current) {
      loadedOnce.current = true;
      load(ROOT);
    }
  }, [active, load]);

  // 拖拽落在文件区之外时阻止浏览器默认行为（否则会直接打开/下载被拖入的文件）
  useEffect(() => {
    if (!active) return undefined;
    const prevent = (e: Event) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, [active]);
  /* ---------------- 上传队列（串行，带进度） ---------------- */

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    while (pendingRef.current.length) {
      const job = pendingRef.current.shift()!;
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        const t0 = Date.now();
        uploadFileTo(job.target, job.file, {
          onProgress: ({ loaded, percent }) => {
            const elapsed = (Date.now() - t0) / 1000;
            const speed = elapsed > 0.3 ? loaded / elapsed : 0;
            const eta = speed > 0 ? (job.size - loaded) / speed : 0;
            setUploads((u) =>
              u.map((x) =>
                x.id === job.id
                  ? { ...x, loaded, percent, speed, eta, status: 'uploading' }
                  : x
              )
            );
          },
          onDone: () => {
            setUploads((u) =>
              u.map((x) =>
                x.id === job.id
                  ? { ...x, loaded: job.size, percent: 100, speed: 0, eta: 0, status: 'done' }
                  : x
              )
            );
            resolve();
          },
          onError: (e) => {
            setUploads((u) =>
              u.map((x) =>
                x.id === job.id ? { ...x, status: 'error', error: e.message } : x
              )
            );
            resolve();
          }
        });
      });
    }
    runningRef.current = false;
    load(pathRef.current); // 全部结束刷新当前目录
  }, [load]);

  // items: [{ file, dir }]，dir 为相对当前目录的子路径（拖入文件夹时保留结构）
  const enqueue = useCallback(
    (items: UploadInput[]) => {
      const list = (items || []).filter((x) => x && x.file);
      if (!list.length) return;
      const base = pathRef.current;
      const stamp = Date.now();
      const recs: UploadItem[] = [];
      const jobs: UploadJob[] = [];
      list.forEach((x, i) => {
        const target = x.dir ? (base ? `${base}/${x.dir}` : x.dir) : base;
        const id = `${stamp}-${i}-${x.dir || ''}-${x.file.name}`;
        recs.push({
          id,
          name: x.dir ? `${x.dir}/${x.file.name}` : x.file.name,
          size: x.file.size,
          loaded: 0,
          percent: 0,
          speed: 0,
          eta: 0,
          status: 'waiting',
          error: ''
        });
        jobs.push({ id, file: x.file, size: x.file.size, target });
      });
      setUploads((u) => [...recs, ...u].slice(0, 40));
      pendingRef.current.push(...jobs);
      pump();
    },
    [pump]
  );

  function clearFinished() {
    setUploads((u) => u.filter((x) => x.status === 'uploading' || x.status === 'waiting'));
  }

  /* ---------------- 拖拽 ---------------- */

  // Dragger 的 beforeUpload：点选文件走这里；拖拽落入由容器 onDrop 递归处理（守卫挡住重复入队）
  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    if (!dropGuardRef.current) enqueue([{ file, dir: '' }]);
    return Upload.LIST_IGNORE;
  };

  // 拖拽进入 Dragger 时置守卫：rc-upload 的 beforeUpload 会在同一事件里同步读取该值
  function armDropGuard() {
    dropGuardRef.current = true;
    window.setTimeout(() => {
      dropGuardRef.current = false;
    }, 0);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt) return;

    // 拖拽数据只在事件同步阶段有效：先把 entry / 文件列表快照出来，再异步展开
    const entries: FileSystemEntry[] = [];
    const items = dt.items ? Array.from(dt.items) : [];
    for (const it of items) {
      if (it.kind !== 'file' || !it.webkitGetAsEntry) continue;
      const entry = it.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    const plain: UploadInput[] = dt.files
      ? Array.from(dt.files).map((f) => ({ file: f, dir: '' }))
      : [];

    if (!entries.length) {
      if (plain.length) enqueue(plain);
      return;
    }

    // 递归展开：支持整个文件夹拖入，并在目标端保留相对目录结构
    (async () => {
      const acc: UploadInput[] = [];
      for (const entry of entries) {
        // eslint-disable-next-line no-await-in-loop
        await walkEntry(entry, '', acc);
      }
      if (acc.length) enqueue(acc);
      else if (plain.length) enqueue(plain);
    })().catch(() => {
      if (plain.length) enqueue(plain);
    });
  }

  /* ---------------- 目录导航 ---------------- */

  function enter(entry: FileEntry) {
    load(path ? `${path}/${entry.name}` : entry.name);
  }

  const crumbs = useMemo(() => {
    const parts = path ? path.split('/') : [];
    const out: { name: string; path: string }[] = [];
    let cur = '';
    parts.forEach((p) => {
      cur = cur ? `${cur}/${p}` : p;
      out.push({ name: p, path: cur });
    });
    return out;
  }, [path]);

  const shown = useMemo(() => {
    const list = [...entries];
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1; // 目录恒在前
      let r = 0;
      if (sort.key === 'name') r = a.name.localeCompare(b.name, 'zh-Hans-CN');
      else if (sort.key === 'size') r = a.size - b.size;
      else r = a.mtime - b.mtime;
      return r * sort.dir;
    });
    return list;
  }, [entries, sort]);

  /* ---------------- 弹窗动作 ---------------- */

  function openDialog(type: 'mkdir' | 'rename', entry?: FileEntry) {
    setDialogErr('');
    if (type === 'mkdir') {
      setDialog({ type, title: '新建文件夹', value: '', target: path });
    } else {
      setDialog({
        type,
        title: '重命名',
        value: entry!.name,
        target: path ? `${path}/${entry!.name}` : entry!.name
      });
    }
  }

  async function submitDialog() {
    if (!dialog) return;
    if (!dialog.value.trim()) return; // 名称为空时不提交（原按钮 disabled 的等价约束）
    setDialogBusy(true);
    setDialogErr('');
    try {
      if (dialog.type === 'mkdir') {
        await makeDir(dialog.target, dialog.value.trim());
      } else {
        await renameEntry(dialog.target, dialog.value.trim());
      }
      setDialog(null);
      await load(pathRef.current);
    } catch (e2) {
      setDialogErr((e2 as Error).message || '操作失败');
    } finally {
      setDialogBusy(false);
    }
  }

  async function doDelete(entry: FileEntry) {
    try {
      await deleteEntry(path ? `${path}/${entry.name}` : entry.name);
      await load(pathRef.current);
    } catch (e2) {
      setErr((e2 as Error).message || '操作失败');
    }
  }

  const activeUploads = uploads.filter((u) => u.status === 'uploading' || u.status === 'waiting');
  const failedUploads = uploads.filter((u) => u.status === 'error');

  const crumbItems = useMemo(
    () => [
      { title: <Typography.Link onClick={() => load(ROOT)}>根目录</Typography.Link> },
      ...crumbs.map((c) => ({
        title: <Typography.Link onClick={() => load(c.path)}>{c.name}</Typography.Link>
      }))
    ],
    [crumbs, load]
  );

  // 排序交给 antd 表头（sorter: true，排序在 shown 里完成，目录恒在前）
  function onTableChange(
    _pagination: unknown,
    _filters: unknown,
    sorter: { columnKey?: string | number; order?: 'ascend' | 'descend' | null } | Array<unknown>
  ) {
    const s = Array.isArray(sorter)
      ? (sorter[0] as { columnKey?: string | number; order?: 'ascend' | 'descend' | null })
      : sorter;
    const key = s && (s.columnKey === 'name' || s.columnKey === 'size' || s.columnKey === 'time')
      ? s.columnKey
      : null;
    if (!key || !s.order) {
      setSort({ key: 'name', dir: 1 });
      return;
    }
    setSort({ key, dir: s.order === 'ascend' ? 1 : -1 });
  }

  const columns: TableProps<FileEntry>['columns'] = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      sortOrder: sort.key === 'name' ? (sort.dir > 0 ? 'ascend' : 'descend') : null,
      render: (_value, entry) => (
        <Space size={8}>
          {entry.type === 'dir' ? <FolderOutlined /> : <FileOutlined />}
          {entry.type === 'dir' ? (
            <Typography.Link title={entry.name} onClick={() => enter(entry)}>
              {entry.name}
            </Typography.Link>
          ) : (
            <Typography.Text title={entry.name}>{entry.name}</Typography.Text>
          )}
          {entry.type === 'file' && extOf(entry.name) && (
            <Typography.Text type="secondary">{extOf(entry.name)}</Typography.Text>
          )}
        </Space>
      )
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 120,
      sorter: true,
      sortOrder: sort.key === 'size' ? (sort.dir > 0 ? 'ascend' : 'descend') : null,
      render: (_value, entry) => (entry.type === 'dir' ? '—' : fmtSize(entry.size))
    },
    {
      title: '修改时间',
      dataIndex: 'mtime',
      key: 'time',
      width: 180,
      sorter: true,
      sortOrder: sort.key === 'time' ? (sort.dir > 0 ? 'ascend' : 'descend') : null,
      render: (_value, entry) => fmtTime(entry.mtime)
    },
    {
      title: '',
      key: 'ops',
      width: 280,
      fixed: 'right',
      render: (_value, entry) => (
        <Space size={0} wrap={false}>
          {entry.type === 'file' && (
            <Button type="link" size="small" href={fileDownloadUrl(path ? `${path}/${entry.name}` : entry.name)}>
              下载
            </Button>
          )}
          {entry.type === 'file' && (
            <Button
              type="link"
              size="small"
              onClick={() =>
                setShareTarget({
                  target: path ? `${path}/${entry.name}` : entry.name,
                  name: entry.name
                })
              }
            >
              链接
            </Button>
          )}
          <Button type="link" size="small" onClick={() => openDialog('rename', entry)}>
            重命名
          </Button>
          <Popconfirm
            title={
              entry.type === 'dir'
                ? `确定删除「${entry.name}」？该目录及其全部内容都会被删除，此操作不可撤销。`
                : `确定删除「${entry.name}」？此操作不可撤销。`
            }
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => doDelete(entry)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div className="files" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {/* 工具栏：面包屑 + 操作 */}
      <div className="files-toolbar">
        <Breadcrumb items={crumbItems} />
        <Space wrap>
          <Button onClick={() => openDialog('mkdir')}>新建文件夹</Button>
          <Button onClick={() => setSharePanel(true)}>临时链接</Button>
          <Button onClick={() => load(path)} disabled={loading}>
            刷新
          </Button>
        </Space>
      </div>

      {err && <Alert type="error" showIcon message={err} />}

      {/* 上传区：拖拽（含整个文件夹）或点选文件 */}
      <div onDropCapture={armDropGuard}>
        <Upload.Dragger multiple showUploadList={false} beforeUpload={beforeUpload} height={140}>
          <Space direction="vertical" size={4}>
            <Typography.Text type="secondary">把文件或整个文件夹拖到这里即可上传</Typography.Text>
            <Button>选择文件</Button>
          </Space>
        </Upload.Dragger>
      </div>

      {/* 上传队列 */}
      {uploads.length > 0 && (
        <Card
          size="small"
          title={
            <>
              上传 {activeUploads.length > 0 ? `中 · 剩余 ${activeUploads.length}` : '完成'}
              {failedUploads.length > 0 ? ` · 失败 ${failedUploads.length}` : ''}
            </>
          }
          extra={
            <Button type="link" size="small" onClick={clearFinished}>
              清除已完成
            </Button>
          }
        >
          {uploads.slice(0, 12).map((u) => (
            <div
              key={u.id}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}
              >
                <Typography.Text ellipsis title={u.name} style={{ maxWidth: 360 }}>
                  {u.name}
                </Typography.Text>
                <Typography.Text type={u.status === 'error' ? 'danger' : 'secondary'}>
                  {uploadMeta(u)}
                </Typography.Text>
              </div>
              <Progress
                percent={u.status === 'done' ? 100 : Math.round(u.percent)}
                size="small"
                showInfo={false}
                status={u.status === 'error' ? 'exception' : u.status === 'done' ? 'success' : 'normal'}
              />
            </div>
          ))}
        </Card>
      )}

      {/* 列表 */}
      <Table<FileEntry>
        sticky={{ offsetHeader: 64 }}
        rowKey="name"
        columns={columns}
        dataSource={shown}
        loading={loading}
        pagination={false}
        onChange={onTableChange as TableProps<FileEntry>['onChange']}
        locale={{ emptyText: '' }}
        scroll={{ x: 'max-content' }}
      />

      {/* 新建 / 重命名 弹窗 */}
      <Modal
        title={dialog?.title}
        open={!!dialog}
        onOk={submitDialog}
        onCancel={() => setDialog(null)}
        okText={dialogBusy ? '处理中…' : '确定'}
        cancelText="取消"
        confirmLoading={dialogBusy}
        maskClosable={false}
        destroyOnHidden
        okButtonProps={{ disabled: !dialog?.value.trim() }}
      >
        {dialog && (
          <Form layout="vertical" onFinish={submitDialog}>
            <Form.Item>
              <Input
                autoFocus
                value={dialog.value}
                onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                placeholder={dialog.type === 'mkdir' ? '文件夹名称' : '新名称'}
              />
            </Form.Item>
          </Form>
        )}
        {dialogErr && <Alert type="error" showIcon message={dialogErr} />}
      </Modal>

      {/* 创建临时链接 */}
      {shareTarget && (
        <ShareCreateModal
          target={shareTarget.target}
          name={shareTarget.name}
          onClose={() => setShareTarget(null)}
        />
      )}

      {/* 临时链接管理面板 */}
      {sharePanel && <ShareManageModal onClose={() => setSharePanel(false)} />}
    </div>
  );
}
