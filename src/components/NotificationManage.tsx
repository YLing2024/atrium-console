import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  async function handleSend(e: FormEvent) {
    e.preventDefault();
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
    if (!window.confirm(`将删除${scope ? '当前筛选' + scope : '全部'}共 ${count} 条通知，删除后不可恢复。确定继续？`)) {
      return;
    }
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
    if (!window.confirm(`将清空全部已读通知，共 ${count} 条，删除后不可恢复。确定继续？`)) return;
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

  return (
    <div className="notif">
      <div className="notif-head">
        <div className="notif-title-row">
          <h2>通知管理</h2>
        </div>
        <div
          className="notif-stats"
          onMouseEnter={() => setShowSources(true)}
          onMouseLeave={() => setShowSources(false)}
        >
          <button
            type="button"
            className="notif-stats-line"
            onClick={() => setShowSources((v) => !v)}
          >
            共 {stats.total} 条 · 未读 {stats.unread} · 来源 {stats.sources.length} 个
          </button>
          {showSources && (
            <div className="notif-stats-pop">
              {stats.sources.length === 0 ? (
                <div className="notif-stats-row muted">暂无来源</div>
              ) : (
                stats.sources.slice(0, 5).map((s) => (
                  <div className="notif-stats-row" key={s.source}>
                    <span className="notif-stats-src">{s.source}</span>
                    <span className="mono">{s.count}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* 发通知：字段与已验收接口一致，POST /api/admin/notifications */}
      <form className="notif-compose" onSubmit={handleSend}>
        <div className="notif-compose-row">
          <div className="notif-compose-col notif-compose-level">
            <label className="field-label" htmlFor="nm-c-level">
              级别
            </label>
            <select
              id="nm-c-level"
              className="input blog-select"
              value={compose.level}
              onChange={(e) => setCompose({ ...compose, level: e.target.value })}
            >
              <option value="urgent">紧急</option>
              <option value="normal">常规</option>
              <option value="digest">汇总</option>
            </select>
          </div>
          <div className="notif-compose-col notif-compose-source">
            <label className="field-label" htmlFor="nm-c-source">
              来源
            </label>
            <input
              id="nm-c-source"
              className="input"
              maxLength={40}
              placeholder="admin"
              value={compose.source}
              onChange={(e) => setCompose({ ...compose, source: e.target.value })}
            />
          </div>
          <div className="notif-compose-col notif-compose-title">
            <label className="field-label" htmlFor="nm-c-title">
              标题
            </label>
            <input
              id="nm-c-title"
              className="input"
              required
              maxLength={80}
              placeholder="给你自己看的通知"
              value={compose.title}
              onChange={(e) => setCompose({ ...compose, title: e.target.value })}
            />
          </div>
        </div>
        <div className="notif-compose-col">
          <label className="field-label" htmlFor="nm-c-body">
            正文（选填，纯文本）
          </label>
          <textarea
            id="nm-c-body"
            className="input notif-compose-text"
            rows={3}
            value={compose.body}
            onChange={(e) => setCompose({ ...compose, body: e.target.value })}
          />
        </div>
        <div className="notif-compose-row">
          <div className="notif-compose-col notif-compose-title">
            <label className="field-label" htmlFor="nm-c-link">
              链接（选填）
            </label>
            <input
              id="nm-c-link"
              className="input"
              type="url"
              placeholder="https://…"
              value={compose.link}
              onChange={(e) => setCompose({ ...compose, link: e.target.value })}
            />
          </div>
          <button
            type="button"
            className="link-btn notif-compose-adv"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? '收起高级' : '高级'}
          </button>
        </div>
        {showAdvanced && (
          <div className="notif-compose-col">
            <label className="field-label" htmlFor="nm-c-dedup">
              去重键（选填）
            </label>
            <input
              id="nm-c-dedup"
              className="input"
              maxLength={200}
              placeholder="10 分钟内相同去重键只保留一条"
              value={compose.dedupKey}
              onChange={(e) => setCompose({ ...compose, dedupKey: e.target.value })}
            />
          </div>
        )}
        <div className="notif-compose-actions">
          <span className="notif-compose-hint muted">发送后会同步推送到 App</span>
          <button type="submit" className="btn-primary" disabled={sending}>
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      </form>

      {/* 发通知后的推送等待/结果（只经服务器 SSE 进入列表；结果留到下次发送） */}
      <PushWaitResult
        state={pushState}
        onRepull={handleRepull}
        repulled={repulled}
        className="notif-push"
      />

      {/* 去重键说明（克制一行） */}
      <p className="manage-desc muted notif-dedup-note">
        去重键：同一去重键 10 分钟内只保留一条，重复提交会更新原通知内容并重新置为未读。
      </p>

      <div className="notif-bar">
        <div className="notif-seg">
          <button
            className={'notif-seg-btn' + (!mUnread ? ' active' : '')}
            onClick={() => setMUnread(false)}
          >
            全部
          </button>
          <button
            className={'notif-seg-btn' + (mUnread ? ' active' : '')}
            onClick={() => setMUnread(true)}
          >
            未读
          </button>
        </div>
        <div className="notif-selects">
          <select className="notif-select" value={mLevel} onChange={(e) => setMLevel(e.target.value)}>
            <option value="">全部级别</option>
            <option value="urgent">紧急</option>
            <option value="normal">常规</option>
            <option value="digest">汇总</option>
          </select>
          <select className="notif-select" value={mSource} onChange={(e) => setMSource(e.target.value)}>
            <option value="">全部来源</option>
            {stats.sources.map((s) => (
              <option key={s.source} value={s.source}>
                {s.source}
              </option>
            ))}
          </select>
        </div>
        <div className="notif-manage">
          <button className="btn-ghost" onClick={handleClearRead}>
            清空已读
          </button>
          <button className="btn-ghost danger" onClick={handleBulkDelete}>
            批量删除
          </button>
        </div>
      </div>

      {notice && <div className="notif-notice ok">{notice}</div>}
      {error && <div className="notif-error error">{error}</div>}
    </div>
  );
}
