import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createFileShare,
  listFileShares,
  updateFileShare,
  deleteFileShare
} from '../api.js';

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

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ms → datetime-local 值（本地时间，分钟精度）
function toDateTimeLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

// datetime-local 值 → ms（按本地时间解析；空 / 非法返回 null）
function toEpochMs(s) {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

// 毫秒时长 → 「x 天 x 小时 / x 小时 x 分 / x 分」
function humanDuration(ms) {
  const min = Math.floor(ms / 60000);
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${mins} 分`;
  return `${Math.max(1, mins)} 分`;
}

// 列表里的有效期文案：永久 / 剩余 x / 已过期 / 已撤销
function expiryText(s) {
  if (s.status === 'revoked') return '已撤销';
  if (s.expiresAt === 0) return '永久';
  if (s.remainingMs > 0) return `剩余 ${humanDuration(s.remainingMs)}`;
  return '已过期';
}

// 剪贴板不可用时回退 window.prompt（与 v2link CopyModal 一致）
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    window.prompt('复制链接', text);
    return false;
  }
}

/* ---------------- 创建：预设有效期 + 自定义时刻 ---------------- */

export function ShareCreateModal({ target, name, onClose }) {
  const [preset, setPreset] = useState('24h');
  const [customAt, setCustomAt] = useState(() => toDateTimeLocal(Date.now() + 24 * HOUR));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  function buildBody() {
    if (preset === 'forever') return { expiresAt: 0 };
    if (preset === 'custom') {
      const ms = toEpochMs(customAt);
      if (ms === null) throw new Error('请选择过期时间');
      if (ms <= Date.now()) throw new Error('过期时间须晚于当前时间');
      return { expiresAt: ms };
    }
    const p = PRESETS.find((x) => x.key === preset) || PRESETS[1];
    return { ttlHours: p.hours };
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (result) return; // 已出结果：回车不再重复创建
    setErr('');
    let body;
    try {
      body = buildBody();
    } catch (e2) {
      setErr(e2.message);
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
      setErr(e2.message || '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    const ok = await copyText(result.url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="modal-mask" onClick={() => !busy && onClose()}>
      <form className="modal fshare-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="modal-title">创建临时链接</h3>
        <div className="fshare-target" title={name}>
          {name}
        </div>

        {result ? (
          <>
            <label className="fshare-field">
              <span className="fshare-label">链接</span>
              <input
                className="input fshare-url mono"
                readOnly
                value={result.url}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <span className="fshare-hint">
              {result.expiresAt === 0
                ? '永久有效，不会自动过期，只能手动撤销。'
                : `有效期至 ${fmtTime(result.expiresAt)}`}
            </span>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={onClose}>
                完成
              </button>
              <button type="button" className="btn-primary" onClick={copy}>
                {copied ? '已复制' : '复制链接'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="fshare-field">
              <span className="fshare-label">有效期</span>
              <div className="fshare-chips">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={'fshare-chip' + (preset === p.key ? ' on' : '')}
                    onClick={() => setPreset(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {preset === 'custom' && (
              <label className="fshare-field">
                <span className="fshare-label">过期时间（本地时间）</span>
                <input
                  type="datetime-local"
                  className="input"
                  value={customAt}
                  onChange={(e) => setCustomAt(e.target.value)}
                />
              </label>
            )}

            <span className="fshare-hint">
              {preset === 'forever'
                ? '永久有效，不会自动过期，只能手动撤销。'
                : '到期后链接自动失效。'}
            </span>

            <label className="fshare-field">
              <span className="fshare-label">备注</span>
              <input
                className="input"
                value={note}
                maxLength={80}
                onChange={(e) => setNote(e.target.value)}
                placeholder="选填"
              />
            </label>

            {err && <div className="error">{err}</div>}

            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? '创建中…' : '创建链接'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

/* ---------------- 改期：改过期时刻本身（转永久 = expiresAt 0） ---------------- */

function ShareScheduleModal({ share, onClose, onDone }) {
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

  async function submit(e) {
    if (e) e.preventDefault();
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

  async function doSubmit(body) {
    setBusy(true);
    try {
      const data = await updateFileShare(share.id, body);
      onDone(data && data.share ? data.share : data);
      onClose();
    } catch (e2) {
      setErr(e2.message || '操作失败');
      setBusy(false);
    }
  }

  return (
    <div className="modal-mask" onClick={() => !busy && onClose()}>
      <form className="modal fshare-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="modal-title">改期</h3>
        <div className="fshare-target" title={share.relPath}>
          {share.relPath}
        </div>

        {!permanent && (
          <div className="fshare-field">
            <span className="fshare-label">方式</span>
            <div className="fshare-chips">
              <button
                type="button"
                className={'fshare-chip' + (mode === 'finite' ? ' on' : '')}
                onClick={() => {
                  setMode('finite');
                  setAbsInput(toDateTimeLocal(share.expiresAt));
                }}
              >
                指定时刻
              </button>
              <button
                type="button"
                className={'fshare-chip' + (mode === 'permanent' ? ' on' : '')}
                onClick={() => setMode('permanent')}
              >
                转为永久
              </button>
            </div>
          </div>
        )}

        {mode === 'finite' ? (
          <label className="fshare-field">
            <span className="fshare-label">过期时间（本地时间）</span>
            <input
              type="datetime-local"
              className="input"
              value={absInput}
              autoFocus
              onChange={(e) => setAbsInput(e.target.value)}
            />
            {hint && <span className="fshare-hint">{hint}</span>}
          </label>
        ) : (
          <span className="fshare-hint">{hint}</span>
        )}

        {err && <div className="error">{err}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? '提交中…' : '确定'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- 管理面板：列表 / 复制 / 改期 / 撤销 / 删除 ---------------- */

export function ShareManageModal({ onClose }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState('');
  const [editing, setEditing] = useState(null);
  const [copiedId, setCopiedId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await listFileShares();
      const list = data && data.shares ? data.shares : Array.isArray(data) ? data : [];
      setShares(list);
    } catch (e) {
      setErr(e.message || '读取失败');
      setShares([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function applyUpdate(updated) {
    if (!updated || !updated.id) return;
    setShares((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  async function copy(s) {
    const ok = await copyText(s.url);
    if (ok) {
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(''), 1500);
    }
  }

  async function revoke(s) {
    if (!window.confirm(`撤销「${s.relPath}」的链接？撤销后不可恢复。`)) return;
    setBusyId(s.id);
    try {
      const data = await updateFileShare(s.id, { revoked: true });
      applyUpdate(data && data.share ? data.share : data);
    } catch (e) {
      window.alert(e.message || '撤销失败');
    } finally {
      setBusyId('');
    }
  }

  async function remove(s) {
    if (!window.confirm(`删除「${s.relPath}」的链接记录？磁盘文件不受影响。`)) return;
    setBusyId(s.id);
    try {
      await deleteFileShare(s.id);
      setShares((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      window.alert(e.message || '删除失败');
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <div className="modal-mask" onClick={onClose}>
        <div className="modal fshare-wide" onClick={(e) => e.stopPropagation()}>
          <div className="fshare-top">
            <h3 className="modal-title">临时链接</h3>
            <button className="link-btn" onClick={load} disabled={loading}>
              刷新
            </button>
          </div>

          {err && <div className="error">{err}</div>}

          {loading ? (
            <div className="fshare-empty">加载中…</div>
          ) : shares.length === 0 ? (
            <div className="fshare-empty">暂无临时链接</div>
          ) : (
            <div className="fshare-list">
              <div className="fshare-row fshare-row-head">
                <span className="fshare-col">文件</span>
                <span className="fshare-col">状态</span>
                <span className="fshare-col">有效期</span>
                <span className="fshare-col">下载</span>
                <span className="fshare-col">创建时间</span>
                <span className="fshare-col">文件</span>
                <span className="fshare-col fshare-col-ops" />
              </div>
              {shares.map((s) => (
                <div className="fshare-row" key={s.id}>
                  <span className="fshare-name" title={s.relPath}>
                    {s.relPath}
                  </span>
                  <span className="fshare-status">
                    <i className={'fshare-dot ' + s.status} />
                    {STATUS_TEXT[s.status] || s.status}
                  </span>
                  <span
                    className="fshare-expiry mono"
                    title={s.expiresAt ? fmtTime(s.expiresAt) : ''}
                  >
                    {expiryText(s)}
                  </span>
                  <span className="fshare-num mono">{s.downloads || 0}</span>
                  <span className="fshare-num mono">{fmtTime(s.createdAt)}</span>
                  <span className={'fshare-file' + (s.fileExists ? '' : ' gone')}>
                    {s.fileExists ? '在' : '已删除'}
                  </span>
                  <span className="fshare-ops">
                    <button className="link-btn" onClick={() => copy(s)}>
                      {copiedId === s.id ? '已复制' : '复制链接'}
                    </button>
                    {s.status === 'active' && (
                      <button className="link-btn" onClick={() => setEditing(s)}>
                        改期
                      </button>
                    )}
                    {s.status === 'active' && (
                      <button
                        className="link-btn danger"
                        onClick={() => revoke(s)}
                        disabled={busyId === s.id}
                      >
                        撤销
                      </button>
                    )}
                    <button
                      className="link-btn danger"
                      onClick={() => remove(s)}
                      disabled={busyId === s.id}
                    >
                      删除记录
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="modal-actions">
            <button className="btn-ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>

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
