import { useCallback, useEffect, useState } from 'react';
import {
  getSessions,
  renameSession,
  deleteSession,
  clearToken,
  redirectToSso
} from '../api.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relativeTime(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

export default function Manage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSessions();
      setSessions(data.sessions || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startRename(s) {
    setEditingId(s.id);
    setEditValue(s.deviceName || '');
    setEditError('');
  }

  function cancelRename() {
    setEditingId(null);
    setEditValue('');
    setEditError('');
  }

  async function saveRename(s) {
    const name = editValue.trim();
    if (!name) {
      setEditError('设备名称不能为空');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await renameSession(s.id, name);
      setSessions((list) => list.map((x) => (x.id === s.id ? { ...x, deviceName: name } : x)));
      cancelRename();
    } catch (e) {
      setEditError(e.message);
    } finally {
      setEditSaving(false);
    }
  }

  function onEditKeyDown(s) {
    return (e) => {
      if (e.key === 'Enter') saveRename(s);
      else if (e.key === 'Escape') cancelRename();
    };
  }

  function askDelete(s) {
    setDeleteTarget(s);
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteSession(deleteTarget.id);
      if (deleteTarget.isCurrent) {
        // 删除当前设备：撤销自身凭证 → 立即跳认证中心重新登录
        clearToken();
        redirectToSso();
        return;
      }
      setSessions((list) => list.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e.message);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="system manage">
      <div className="system-head">
        <h2>设备管理</h2>
        <button className="btn-ghost" onClick={load} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      <p className="manage-desc muted">
        删除设备会撤销其登录凭证，该设备必须重新认证才能进入管理后台。
      </p>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="empty">加载中…</div>
      ) : sessions.length === 0 ? (
        <div className="empty">暂无已登录设备</div>
      ) : (
        <div className="blog-table-wrap">
          <table className="blog-table dev-table">
            <thead>
              <tr>
                <th>设备</th>
                <th>设备 IP</th>
                <th>登录地点</th>
                <th>登录时间</th>
                <th>最近活跃</th>
                <th>凭证过期</th>
                <th className="blog-ops">操作</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const editing = editingId === s.id;
                return (
                  <tr key={s.id}>
                    <td>
                      {editing ? (
                        <div className="dev-edit">
                          <input
                            className="input dev-edit-input"
                            value={editValue}
                            maxLength={64}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={onEditKeyDown(s)}
                            disabled={editSaving}
                            placeholder="设备名称"
                            autoFocus
                          />
                          {editError && <div className="error dev-edit-error">{editError}</div>}
                        </div>
                      ) : (
                        <>
                          <div className="dev-name">
                            <span className="dev-name-text">{s.deviceName || '未命名设备'}</span>
                            {s.isCurrent && <span className="dev-badge">当前设备</span>}
                          </div>
                          {s.userAgent && <div className="dev-ua muted">{s.userAgent}</div>}
                        </>
                      )}
                    </td>
                    <td className="dev-ip">{s.ip || '—'}</td>
                    <td className="muted">{s.isLocal ? '本地网络' : s.location || '—'}</td>
                    <td className="dev-time">{formatTime(s.createdAt)}</td>
                    <td className="dev-time">{relativeTime(s.lastSeenAt)}</td>
                    <td className="dev-time">{formatTime(s.expiresAt * 1000)}</td>
                    <td className="blog-ops">
                      {editing ? (
                        <>
                          <button className="link-btn" onClick={() => saveRename(s)} disabled={editSaving}>
                            保存
                          </button>
                          <button className="link-btn" onClick={cancelRename} disabled={editSaving}>
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="link-btn" onClick={() => startRename(s)}>
                            重命名
                          </button>
                          <button className="link-btn danger" onClick={() => askDelete(s)}>
                            删除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-mask" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">删除设备</div>
            <p className="modal-body">
              删除设备「{deleteTarget.deviceName || '未命名设备'}」并撤销其登录凭证？
            </p>
            <p className="modal-body muted">
              {deleteTarget.isCurrent
                ? '该设备将立即退出，必须重新认证才能进入管理后台。'
                : '该设备将立即失效，必须重新 TOTP 认证后才能进入管理后台。'}
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                取消
              </button>
              <button className="btn-primary" onClick={confirmDelete} disabled={deleting}>
                {deleting ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
