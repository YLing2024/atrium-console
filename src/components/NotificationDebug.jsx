import { useEffect, useRef, useState } from 'react';
import { createNotification, getNotifications } from '../api.js';
import { usePushWait } from '../notificationPush.js';
import { useNotificationStream, notificationStreamLabel } from '../notificationStream.js';
import PushWaitResult from './PushWaitResult.jsx';

/**
 * 通知调试（调试页的第一个工具）：
 *  1) 实时状态：SSE 是否已连接、最近一次事件/心跳时间（相对）、当前未读数；
 *  2) 发一条测试通知（默认 source=admin-debug）：POST 成功后不本地刷新未读、不插入，
 *     只等待服务器 SSE 推回并显示耗时/超时（连通性检测）；
 *  3) 接口说明：字段表 + 运行时域名拼出的可复制 curl；
 *  4) 调用结果：最近一次调用的 HTTP 状态与响应体（截断）。
 *
 * 域名一律运行时取 window.location.origin，禁止硬编码（仓库红线）。
 */

const TRUNCATE = 600;

function relativeTime(ts, now) {
  if (!ts) return '—';
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function truncate(text) {
  const s = String(text == null ? '' : text);
  return s.length > TRUNCATE ? s.slice(0, TRUNCATE) + '…' : s;
}

export default function NotificationDebug() {
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const [level, setLevel] = useState('normal');
  const [title, setTitle] = useState('测试通知');
  const [body, setBody] = useState('来自 Admin 的调试消息');
  const [sending, setSending] = useState(false);
  const [callResult, setCallResult] = useState(null); // { ok, status, body, at }
  const [copied, setCopied] = useState(false);
  const [repulled, setRepulled] = useState(false);
  const { pushState, beginPushWait, markWaiting, resetPushWait } = usePushWait();

  const curlRef = useRef(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const curl =
    `curl -X POST ${origin}/api/admin/notifications \\\n` +
    `  -H 'Content-Type: application/json' \\\n` +
    `  -H 'Authorization: Bearer <API Token>' \\\n` +
    `  -d '{"level":"normal","source":"debug","title":"测试通知","body":"来自 Admin 调试"}'`;

  // 相对时间每秒刷新
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function refreshUnread() {
    try {
      const d = await getNotifications({ limit: 1 });
      setUnread(Number(d.unread) || 0);
    } catch (e) {
      // 忽略
    }
  }

  // 未读数：挂载时 + 每 15s 兜底刷新
  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE 实时流（全站单例）：本页只读状态；推送到达时刷新未读（等待推送的调度在 notificationPush）。
  const stream = useNotificationStream({
    onNotification: () => refreshUnread(),
    onResync: () => refreshUnread()
  });

  // 发测试通知：默认 source=admin-debug；记录 HTTP 状态与响应体。
  // 铁律：不本地刷新未读、不插入——只等服务器 SSE 推回（到达/超时由 PushWaitResult 呈现）
  async function handleSendTest(e) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setCallResult({ ok: false, status: 0, body: '标题不能为空', at: Date.now() });
      return;
    }
    const payload = { level, source: 'admin-debug', title: t, body };
    const startedAt = Date.now();
    setSending(true);
    setRepulled(false);
    markWaiting(startedAt);
    try {
      const data = await createNotification(payload);
      setCallResult({ ok: true, status: 201, body: JSON.stringify(data), at: Date.now() });
      beginPushWait({ id: data && data.id, title: t, source: 'admin-debug' }, startedAt);
    } catch (err) {
      resetPushWait();
      setCallResult({
        ok: false,
        status: err.status || 0,
        body: err.message || '发送失败',
        at: Date.now()
      });
    } finally {
      setSending(false);
    }
  }

  // 超时后的显式动作：重新拉取（用户主动触发，允许刷新未读计数）
  function handleRepull() {
    setRepulled(true);
    refreshUnread();
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // 复制失败静默降级：选中文本便于手动复制
      try {
        const el = curlRef.current;
        if (el) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (e2) {
        // 忽略
      }
    }
  }

  return (
    <div className="ndbg">
      {/* 1) 实时状态 */}
      <section className="ndbg-block">
        <h3 className="ndbg-title">实时状态</h3>
        <div className="ndbg-status" data-conn={stream.status}>
          <span
            className={
              'ndbg-dot' +
              (stream.status === 'connected'
                ? ' on'
                : stream.status === 'reconnecting'
                  ? ' warn'
                  : '')
            }
          />
          <span>{notificationStreamLabel(stream, now)}</span>
          <span className="muted">·</span>
          <span className="muted">最近事件 {relativeTime(stream.lastEventAt, now)}</span>
          <span className="muted">·</span>
          <span className="muted">最近心跳 {relativeTime(stream.lastHeartbeatAt, now)}</span>
          <span className="muted">·</span>
          <span>
            未读 <span className="mono">{unread}</span>
          </span>
        </div>
      </section>

      {/* 2) 发一条测试通知 */}
      <section className="ndbg-block">
        <h3 className="ndbg-title">发一条测试通知</h3>
        <form className="ndbg-send" onSubmit={handleSendTest}>
          <div className="ndbg-send-row">
            <div className="notif-compose-col ndbg-send-level">
              <label className="field-label" htmlFor="ndbg-level">
                级别
              </label>
              <select
                id="ndbg-level"
                className="input blog-select"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="urgent">紧急</option>
                <option value="normal">常规</option>
                <option value="digest">汇总</option>
              </select>
            </div>
            <div className="notif-compose-col ndbg-send-title">
              <label className="field-label" htmlFor="ndbg-title">
                标题
              </label>
              <input
                id="ndbg-title"
                className="input"
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          <div className="notif-compose-col">
            <label className="field-label" htmlFor="ndbg-body">
              正文
            </label>
            <textarea
              id="ndbg-body"
              className="input notif-compose-text"
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="ndbg-send-actions">
            <span className="muted ndbg-src-hint">来源固定为 admin-debug</span>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? '发送中…' : '发送测试通知'}
            </button>
          </div>
        </form>
        {/* 发测试通知后的推送等待/结果（结果留到下次发送） */}
        <PushWaitResult
          state={pushState}
          onRepull={handleRepull}
          repulled={repulled}
          className="ndbg-push"
        />
      </section>

      {/* 3) 接口说明 */}
      <section className="ndbg-block">
        <div className="ndbg-block-head">
          <h3 className="ndbg-title">接口说明</h3>
          <button type="button" className="btn-ghost" onClick={copyCurl}>
            {copied ? '已复制' : '复制 curl'}
          </button>
        </div>
        <table className="ndbg-table">
          <thead>
            <tr>
              <th>字段</th>
              <th>必填</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">level</td>
              <td>是</td>
              <td>urgent / normal / digest</td>
            </tr>
            <tr>
              <td className="mono">source</td>
              <td>是</td>
              <td>来源标识，如 admin / debug</td>
            </tr>
            <tr>
              <td className="mono">title</td>
              <td>是</td>
              <td>标题，≤ 80 字</td>
            </tr>
            <tr>
              <td className="mono">body</td>
              <td>否</td>
              <td>正文，纯文本</td>
            </tr>
            <tr>
              <td className="mono">link</td>
              <td>否</td>
              <td>跳转链接</td>
            </tr>
            <tr>
              <td className="mono">dedupKey</td>
              <td>否</td>
              <td>去重键，10 分钟内相同键只保留一条</td>
            </tr>
          </tbody>
        </table>
        <p className="muted ndbg-note">
          鉴权：网关登录会话（浏览器内自动带 cookie）或可写 API Token（见「管理」页）。
        </p>
        <pre className="ndbg-curl" ref={curlRef}>{curl}</pre>
      </section>

      {/* 4) 调用结果 */}
      <section className="ndbg-block">
        <h3 className="ndbg-title">调用结果</h3>
        {callResult ? (
          <div className="ndbg-result">
            <div className={'ndbg-result-status' + (callResult.ok ? ' ok' : ' bad')}>
              HTTP {callResult.status || '—'}
            </div>
            <pre className="ndbg-result-body">{truncate(callResult.body)}</pre>
          </div>
        ) : (
          <div className="muted ndbg-note">尚无调用</div>
        )}
      </section>
    </div>
  );
}
