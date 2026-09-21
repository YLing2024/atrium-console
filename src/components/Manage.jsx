import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSessions,
  renameSession,
  deleteSession,
  getApiTokens,
  createApiToken,
  updateApiToken,
  deleteApiToken,
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

function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function remainingDays(expiresAt) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 86400000));
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
  const renameInFlight = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ===== 接口令牌状态 =====
  const [apiTokens, setApiTokens] = useState([]);
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
  const [createdToken, setCreatedToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDays, setEditDays] = useState('');
  const [editCanWrite, setEditCanWrite] = useState(false);
  const [apiEditSaving, setApiEditSaving] = useState(false);
  const [apiEditError, setApiEditError] = useState('');
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

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

  const loadTokens = useCallback(async () => {
    setApiLoading(true);
    setApiError('');
    try {
      const data = await getApiTokens();
      setApiTokens(data.tokens || []);
    } catch (e) {
      setApiError(e.message);
    } finally {
      setApiLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadTokens();
  }, [load, loadTokens]);

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
      setEditError(e.message);
    } finally {
      renameInFlight.current = false;
      setEditSaving(false);
    }
  }

  function onEditKeyDown(s) {
    return (e) => {
      if (e.key === 'Enter') saveRename(s);
      else if (e.key === 'Escape') e.currentTarget.blur(); // 失焦触发自动保存，等价保存、避免丢输入
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
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function copyToken(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setCopied(false);
    }
  }

  function openEdit(t) {
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
    const patch = {};
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
      setApiEditError(e.message);
    } finally {
      setApiEditSaving(false);
    }
  }

  function askRevoke(t) {
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
      setApiError(e.message);
      setRevokeTarget(null);
    } finally {
      setRevoking(false);
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
                            onBlur={() => saveRename(s)}
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
                            <button
                              type="button"
                              className="dev-rename-btn"
                              onClick={() => startRename(s)}
                              title="重命名设备"
                              aria-label="重命名设备"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="12"
                                height="12"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                            </button>
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
                        </>
                      ) : (
                        <button className="link-btn danger" onClick={() => askDelete(s)}>
                          删除
                        </button>
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

      {/* ============ 接口令牌区块（与设备管理视觉隔离，独立表格） ============ */}
      <div className="manage-sep" />
      <div className="system-head">
        <h2>接口令牌</h2>
        <button className="btn-ghost" onClick={openCreate} disabled={creating}>
          生成令牌
        </button>
      </div>

      <p className="manage-desc muted">
        接口令牌用于第三方工具调用 Admin 接口。调用时在请求头携带{' '}
        <code className="usage-code">Authorization: Bearer &lt;令牌&gt;</code> 即可。
        令牌与登录设备相互独立，不占用设备登录。请妥善保管令牌，泄露可随时吊销。
        标记为「只读」的令牌只能读取；需要调用写入接口（如发通知）请在创建时勾选「允许写入」。
      </p>

      {apiError && <div className="error">{apiError}</div>}

      {apiLoading ? (
        <div className="empty">加载中…</div>
      ) : apiTokens.length === 0 ? (
        <div className="empty">暂无接口令牌</div>
      ) : (
        <div className="blog-table-wrap">
          <table className="blog-table api-token-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>备注</th>
                <th>权限</th>
                <th>创建时间</th>
                <th>过期时间</th>
                <th>最近使用</th>
                <th className="blog-ops">操作</th>
              </tr>
            </thead>
            <tbody>
              {apiTokens.map((t) => {
                const expired = t.expiresAt > 0 && t.expiresAt <= Date.now();
                return (
                  <tr key={t.id}>
                    <td className="api-token-name">{t.name}</td>
                    <td className="muted">{t.note || '—'}</td>
                    <td>
                      <span className={'api-token-perm' + (t.canWrite ? ' write' : '')}>
                        {t.canWrite ? '可写' : '只读'}
                      </span>
                    </td>
                    <td className="dev-time">{formatDate(t.createdAt)}</td>
                    <td className="dev-time">
                      {expired ? (
                        <span className="blog-status danger">已过期</span>
                      ) : (
                        <span>
                          {formatDate(t.expiresAt)} · 剩余 {remainingDays(t.expiresAt)} 天
                        </span>
                      )}
                    </td>
                    <td className="dev-time">
                      {t.lastUsedAt ? formatTime(t.lastUsedAt) : <span className="muted">从未使用</span>}
                    </td>
                    <td className="blog-ops">
                      <button className="link-btn" onClick={() => openEdit(t)}>
                        编辑
                      </button>
                      <button className="link-btn danger" onClick={() => askRevoke(t)}>
                        吊销
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 生成令牌弹窗 */}
      {showCreate && (
        <div className="modal-mask" onClick={() => !creating && setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">生成接口令牌</div>
            <label className="field-label" htmlFor="api-token-name">令牌名称</label>
            <input
              id="api-token-name"
              className="input"
              value={createName}
              maxLength={64}
              placeholder="如：行情脚本"
              onChange={(e) => setCreateName(e.target.value)}
            />
            <label className="field-label" htmlFor="api-token-note">备注（选填）</label>
            <input
              id="api-token-note"
              className="input"
              value={createNote}
              maxLength={200}
              placeholder="用途说明"
              onChange={(e) => setCreateNote(e.target.value)}
            />
            <label className="field-label" htmlFor="api-token-days">有效期</label>
            <select
              id="api-token-days"
              className="input blog-select"
              value={createDays}
              onChange={(e) => setCreateDays(e.target.value)}
            >
              <option value="7">7 天</option>
              <option value="30">30 天</option>
              <option value="90">90 天</option>
              <option value="custom">自定义天数</option>
            </select>
            {createDays === 'custom' && (
              <input
                className="input"
                type="number"
                min="1"
                max="365"
                placeholder="1~365"
                value={createCustomDays}
                onChange={(e) => setCreateCustomDays(e.target.value)}
              />
            )}
            <label className="checkbox-row" htmlFor="api-token-canwrite">
              <input
                id="api-token-canwrite"
                type="checkbox"
                checked={createCanWrite}
                onChange={(e) => setCreateCanWrite(e.target.checked)}
              />
              <span>允许写入（可调用发通知等写入接口）</span>
            </label>
            {createError && <div className="error">{createError}</div>}
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setShowCreate(false)} disabled={creating}>
                取消
              </button>
              <button className="btn-primary" onClick={submitCreate} disabled={creating}>
                {creating ? '生成中…' : '生成'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 令牌展示弹窗（明文仅此一次） */}
      {createdToken && (
        <div className="modal-mask" onClick={() => setCreatedToken(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">接口令牌已生成</div>
            <p className="modal-body muted">令牌仅显示一次，关闭后无法再次查看，请立即保存。</p>
            <div className="token-display">
              {createdToken.token}
            </div>
            <div className="token-actions">
              <button className="btn-primary" onClick={() => copyToken(createdToken.token)}>
                {copied ? '已复制' : '复制令牌'}
              </button>
            </div>
            <label className="field-label">curl 用法示例</label>
            <div className="curl-display">{createdToken.curl}</div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setCreatedToken(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑令牌弹窗 */}
      {editTarget && (
        <div className="modal-mask" onClick={() => !apiEditSaving && setEditTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">编辑接口令牌</div>
            <label className="field-label" htmlFor="edit-token-name">令牌名称</label>
            <input
              id="edit-token-name"
              className="input"
              value={editName}
              maxLength={64}
              onChange={(e) => setEditName(e.target.value)}
            />
            <label className="field-label" htmlFor="edit-token-note">备注（选填）</label>
            <input
              id="edit-token-note"
              className="input"
              value={editNote}
              maxLength={200}
              placeholder="用途说明"
              onChange={(e) => setEditNote(e.target.value)}
            />
            <label className="field-label" htmlFor="edit-token-days">重置有效期（选填）</label>
            <input
              id="edit-token-days"
              className="input"
              type="number"
              min="1"
              max="365"
              placeholder="留空则保持当前有效期"
              value={editDays}
              onChange={(e) => setEditDays(e.target.value)}
            />
            <label className="checkbox-row" htmlFor="edit-token-canwrite">
              <input
                id="edit-token-canwrite"
                type="checkbox"
                checked={editCanWrite}
                onChange={(e) => setEditCanWrite(e.target.checked)}
              />
              <span>允许写入（可调用发通知等写入接口）</span>
            </label>
            {apiEditError && <div className="error">{apiEditError}</div>}
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setEditTarget(null)} disabled={apiEditSaving}>
                取消
              </button>
              <button className="btn-primary" onClick={submitEdit} disabled={apiEditSaving}>
                {apiEditSaving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 吊销确认弹窗 */}
      {revokeTarget && (
        <div className="modal-mask" onClick={() => !revoking && setRevokeTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">吊销接口令牌</div>
            <p className="modal-body">
              吊销令牌「{revokeTarget.name}」？吊销后立即失效，使用该令牌的工具将无法再调用接口。
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setRevokeTarget(null)} disabled={revoking}>
                取消
              </button>
              <button className="btn-primary" onClick={confirmRevoke} disabled={revoking}>
                {revoking ? '吊销中…' : '吊销'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
