import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listFiles,
  makeDir,
  renameEntry,
  deleteEntry,
  fileDownloadUrl,
  uploadFileTo
} from '../api.js';

/**
 * 文件区：目录浏览 / 拖拽上传（带进度条）/ 新建文件夹 / 重命名 / 删除 / 下载。
 * 路径均为相对文件区根目录的相对路径，越界由后端拦截。
 */

const ROOT = '';

function fmtSize(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${Math.ceil(sec)} 秒`;
  return `${Math.floor(sec / 60)} 分 ${Math.ceil(sec % 60)} 秒`;
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toUpperCase().slice(0, 5);
}

// 递归读取拖入的目录条目（DataTransfer 的 webkitGetAsEntry）
function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const out = [];
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
async function walkEntry(entry, dir, acc) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    acc.push({ file, dir });
    return;
  }
  if (entry.isDirectory) {
    const sub = dir ? `${dir}/${entry.name}` : entry.name;
    const children = await readAllEntries(entry.createReader());
    for (const c of children) {
      // eslint-disable-next-line no-await-in-loop
      await walkEntry(c, sub, acc);
    }
  }
}

function IconFolder() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M1.5 3.5h4.2l1.4 2h7.4v8h-13z" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M3.5 1.5h5.6l3.4 3.4v9.6h-9z" />
      <path d="M9.1 1.5v3.4h3.4" />
    </svg>
  );
}

export default function Files({ active }) {
  const [path, setPath] = useState(ROOT);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [uploads, setUploads] = useState([]);
  const [dialog, setDialog] = useState(null); // { type: 'mkdir'|'rename'|'delete', target, value, title }
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogErr, setDialogErr] = useState('');

  const dragDepth = useRef(0);
  const loadedOnce = useRef(false);
  const pendingRef = useRef([]);
  const runningRef = useRef(false);
  const pathRef = useRef(ROOT);
  const fileInputRef = useRef(null);

  pathRef.current = path;

  const load = useCallback(async (p) => {
    setLoading(true);
    setErr('');
    try {
      const data = await listFiles(p);
      setEntries(data.entries || []);
      setPath(data.path || '');
    } catch (e) {
      setErr(e.message || '读取失败');
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

  // 拖拽落在 .files 之外时阻止浏览器默认行为（否则会直接打开/下载被拖入的文件）
  useEffect(() => {
    if (!active) return undefined;
    const prevent = (e) => e.preventDefault();
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
      const job = pendingRef.current.shift();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
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
    (items) => {
      const list = (items || []).filter((x) => x && x.file);
      if (!list.length) return;
      setNotice('');
      const base = pathRef.current;
      const stamp = Date.now();
      const recs = [];
      const jobs = [];
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

  function onDragEnter(e) {
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }

  function onDragOver(e) {
    e.preventDefault();
  }

  function onDragLeave(e) {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragOver(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const dt = e.dataTransfer;
    if (!dt) return;

    // 拖拽数据只在事件同步阶段有效：先把 entry / 文件列表快照出来，再异步展开
    const entries = [];
    const items = dt.items ? Array.from(dt.items) : [];
    for (const it of items) {
      if (it.kind !== 'file' || !it.webkitGetAsEntry) continue;
      const entry = it.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    const plain = dt.files ? Array.from(dt.files).map((f) => ({ file: f, dir: '' })) : [];

    if (!entries.length) {
      if (plain.length) enqueue(plain);
      return;
    }

    // 递归展开：支持整个文件夹拖入，并在目标端保留相对目录结构
    (async () => {
      const acc = [];
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

  function enter(entry) {
    load(path ? `${path}/${entry.name}` : entry.name);
  }

  const crumbs = useMemo(() => {
    const parts = path ? path.split('/') : [];
    const out = [];
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

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  }

  /* ---------------- 弹窗动作 ---------------- */

  function openDialog(type, entry) {
    setDialogErr('');
    if (type === 'mkdir') {
      setDialog({ type, title: '新建文件夹', value: '', target: path });
    } else if (type === 'rename') {
      setDialog({
        type,
        title: '重命名',
        value: entry.name,
        target: path ? `${path}/${entry.name}` : entry.name
      });
    } else if (type === 'delete') {
      setDialog({
        type,
        title: '删除',
        value: entry.name,
        target: path ? `${path}/${entry.name}` : entry.name,
        isDir: entry.type === 'dir'
      });
    }
  }

  async function submitDialog(e) {
    if (e) e.preventDefault();
    if (!dialog) return;
    setDialogBusy(true);
    setDialogErr('');
    try {
      if (dialog.type === 'mkdir') {
        await makeDir(dialog.target, dialog.value.trim());
      } else if (dialog.type === 'rename') {
        await renameEntry(dialog.target, dialog.value.trim());
      } else if (dialog.type === 'delete') {
        await deleteEntry(dialog.target);
      }
      setDialog(null);
      await load(pathRef.current);
    } catch (e2) {
      setDialogErr(e2.message || '操作失败');
    } finally {
      setDialogBusy(false);
    }
  }

  const activeUploads = uploads.filter((u) => u.status === 'uploading' || u.status === 'waiting');
  const failedUploads = uploads.filter((u) => u.status === 'error');

  return (
    <div
      className={'files' + (dragOver ? ' is-drag' : '')}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* 工具栏：面包屑 + 操作 */}
      <div className="files-bar">
        <div className="files-crumbs">
          <button className={'crumb' + (path === '' ? ' current' : '')} onClick={() => load(ROOT)}>
            根目录
          </button>
          {crumbs.map((c, i) => (
            <span key={c.path} className="crumb-wrap">
              <span className="crumb-sep">/</span>
              <button
                className={'crumb' + (i === crumbs.length - 1 ? ' current' : '')}
                onClick={() => load(c.path)}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>
        <div className="files-actions">
          <button className="btn-ghost" onClick={() => openDialog('mkdir')}>
            新建文件夹
          </button>
          <button className="btn-ghost" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
            选择文件
          </button>
          <button className="btn-ghost" onClick={() => load(path)} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          enqueue(Array.from(e.target.files || []).map((f) => ({ file: f, dir: '' })));
          e.target.value = '';
        }}
      />

      {notice && (
        <div className="files-notice">
          {notice}
          <button className="link-btn" onClick={() => setNotice('')}>
            知道了
          </button>
        </div>
      )}

      {/* 上传队列 */}
      {uploads.length > 0 && (
        <div className="files-uploads">
          <div className="files-uploads-head">
            <span className="files-uploads-title">
              上传 {activeUploads.length > 0 ? `中 · 剩余 ${activeUploads.length}` : '完成'}
              {failedUploads.length > 0 ? ` · 失败 ${failedUploads.length}` : ''}
            </span>
            <button className="link-btn" onClick={clearFinished}>
              清除已完成
            </button>
          </div>
          <div className="files-uploads-list">
            {uploads.slice(0, 12).map((u) => (
              <div className="up-item" key={u.id}>
                <div className="up-head">
                  <span className="up-name" title={u.name}>
                    {u.name}
                  </span>
                  <span className="up-meta mono">
                    {u.status === 'error'
                      ? u.error
                      : u.status === 'done'
                        ? `${fmtSize(u.size)} · 完成`
                        : `${fmtSize(u.loaded)} / ${fmtSize(u.size)} · ${u.percent.toFixed(0)}%` +
                          (u.speed ? ` · ${fmtSize(u.speed)}/s` : '') +
                          (u.eta ? ` · 剩余 ${fmtDuration(u.eta)}` : '')}
                  </span>
                </div>
                <div className={'up-bar ' + u.status}>
                  <div className="up-bar-fill" style={{ width: `${u.status === 'done' ? 100 : u.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 列表 */}
      <div className="files-body">
        <div className="files-head">
          <button className="files-col col-name" onClick={() => toggleSort('name')}>
            名称 {sort.key === 'name' ? (sort.dir > 0 ? '↑' : '↓') : ''}
          </button>
          <button className="files-col col-size" onClick={() => toggleSort('size')}>
            大小 {sort.key === 'size' ? (sort.dir > 0 ? '↑' : '↓') : ''}
          </button>
          <button className="files-col col-time" onClick={() => toggleSort('time')}>
            修改时间 {sort.key === 'time' ? (sort.dir > 0 ? '↑' : '↓') : ''}
          </button>
          <span className="files-col col-ops" />
        </div>

        {err && <div className="files-empty error">{err}</div>}

        {!err && !loading && shown.length === 0 && (
          <div className="files-empty">
            把文件或整个文件夹拖到这里即可上传
          </div>
        )}

        {!err &&
          shown.map((entry) => (
            <div className="files-row" key={entry.name}>
              <div className="files-col col-name">
                <span className={'files-icon' + (entry.type === 'dir' ? ' is-dir' : '')}>
                  {entry.type === 'dir' ? <IconFolder /> : <IconFile />}
                </span>
                {entry.type === 'dir' ? (
                  <button className="files-name is-dir" onClick={() => enter(entry)}>
                    {entry.name}
                  </button>
                ) : (
                  <span className="files-name" title={entry.name}>
                    {entry.name}
                  </span>
                )}
                {entry.type === 'file' && extOf(entry.name) && (
                  <span className="files-ext mono">{extOf(entry.name)}</span>
                )}
              </div>
              <div className="files-col col-size mono">
                {entry.type === 'dir' ? '—' : fmtSize(entry.size)}
              </div>
              <div className="files-col col-time mono">{fmtTime(entry.mtime)}</div>
              <div className="files-col col-ops">
                {entry.type === 'file' && (
                  <a className="link-btn" href={fileDownloadUrl(path ? `${path}/${entry.name}` : entry.name)}>
                    下载
                  </a>
                )}
                <button className="link-btn" onClick={() => openDialog('rename', entry)}>
                  重命名
                </button>
                <button className="link-btn danger" onClick={() => openDialog('delete', entry)}>
                  删除
                </button>
              </div>
            </div>
          ))}
      </div>

      {dragOver && <div className="files-dropzone">松开即上传到当前目录</div>}

      {/* 新建 / 重命名 / 删除 弹窗 */}
      {dialog && (
        <div className="modal-mask" onClick={() => !dialogBusy && setDialog(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submitDialog}>
            <h3 className="modal-title">{dialog.title}</h3>
            {dialog.type === 'delete' ? (
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                确定删除「{dialog.value}」？
                {dialog.isDir ? '该目录及其全部内容都会被删除，' : ''}此操作不可撤销。
              </p>
            ) : (
              <input
                className="input"
                autoFocus
                value={dialog.value}
                onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                placeholder={dialog.type === 'mkdir' ? '文件夹名称' : '新名称'}
              />
            )}
            {dialogErr && <div className="error">{dialogErr}</div>}
            <div className="modal-actions">
              <button className="btn-ghost" type="button" onClick={() => setDialog(null)} disabled={dialogBusy}>
                取消
              </button>
              <button
                className="btn-primary"
                type="submit"
                disabled={dialogBusy || (dialog.type !== 'delete' && !dialog.value.trim())}
              >
                {dialogBusy ? '处理中…' : dialog.type === 'delete' ? '删除' : '确定'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
