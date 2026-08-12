import { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getHistorySessions, getHistoryMessages, downloadUrl } from '../api.js';
import { parseMediaTags } from '../mediaTags.js';
import { parseImageRefs } from '../imageRefs.js';
import { parseFileRefs } from '../fileRefs.js';

// 模块顶层配置：单换行渲染为换行 + GFM（表格/任务列表等）
marked.setOptions({ breaks: true, gfm: true });

// 写剪贴板（Clipboard API 优先，非 HTTPS 退化为 textarea + execCommand），返回是否成功。
// 供消息复制 toast 与代码块复制按钮（事件委托）共用。
async function writeClipboard(text) {
  const t = (text || '').replace(/\n$/, '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(t);
    } else {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    return true;
  } catch {
    return false;
  }
}

// 解析消息时间戳（秒/毫秒均可），无则返回 null
function parseTs(raw) {
  if (raw == null || raw === '') return null;
  let t;
  if (typeof raw === 'number') t = raw;
  else if (/^\d+$/.test(String(raw))) t = Number(raw);
  else t = new Date(raw).getTime();
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  if (t < 1e12) t *= 1000; // 秒 -> 毫秒
  return t;
}

function toSessions(data) {
  const arr = (data && data.sessions) || [];
  return arr.map((s) => ({
    id: s.id || '',
    title: s.title || s.id || '会话',
    time: parseTs(s.time ?? s.last_activity_at ?? s.started_at),
    message_count: s.message_count != null ? s.message_count : 0
  }));
}

// 消息归一化：content 内 @image: 引用解析为 images（走 .msg-imgs / lightbox 渲染）
function toMessages(data) {
  const arr = (data && data.messages) || [];
  return arr
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : '';
      const parsed = parseImageRefs(content);
      return {
        id: m.id || m.message_id || '',
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: parsed.text,
        images: (m.image_paths || m.images || []).concat(parsed.images),
        ts: parseTs(m.ts ?? m.timestamp)
      };
    });
}

// 时间显示：同日 HH:MM，跨天 MM-DD HH:MM
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const pad = (n) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameDay ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

// 富文本清理：交给 DOMPurify 移除可执行标签、on* 事件、javascript/vbscript/data 危险协议链接
function renderMd(text) {
  return DOMPurify.sanitize(marked.parse(text || ''));
}

// 代码块复制按钮：仅挂“复制”按钮（不绑监听），点击由 Browse 层事件委托统一处理
function Markdown({ html }) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('pre').forEach((pre) => {
      if (!pre.querySelector('.md-copy-btn')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-copy-btn';
        btn.textContent = '复制';
        pre.appendChild(btn);
      }
    });
  }, [html]);
  return <div className="md" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

// 文件卡片类型标识：ZIP/AUD/VID/DOC 用琥珀文字标签，通用附件返回 'FILE'
function fileIcon(ext) {
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'apk', 'ipa'].includes(ext)) return 'ZIP';
  if (['mp3', 'm2a', 'wav', 'ogg', 'opus', 'm4a', 'flac'].includes(ext)) return 'AUD';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp'].includes(ext)) return 'VID';
  if (['pdf', 'doc', 'docx', 'odt', 'rtf', 'md', 'txt', 'epub', 'xls', 'xlsx', 'ods', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'DOC';
  return 'FILE';
}

// MEDIA 图片渲染：加载失败（download 接口 400 / 路径不存在）时不显示破图，
// 切换为深色占位；正常图片加载成功照常显示、可点击放大。
function MediaImage({ src, alt, onClick }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) {
    return (
      <div
        className="msg-img msg-img-failed"
        role="img"
        aria-label="图片加载失败"
        title="图片加载失败"
      >
        <svg
          className="msg-img-failed-icon"
          viewBox="0 0 24 24"
          width="26"
          height="26"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="square"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" />
          <circle cx="8.5" cy="8.5" r="1.6" />
          <path d="M21 15l-5-5L4 22" />
        </svg>
        <span className="msg-img-failed-text">图片加载失败</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="msg-img"
      onClick={onClick}
      onError={() => setFailed(true)}
    />
  );
}

// 下载按钮细线图标
function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M12 3v12m0 0l-5-5m5 5l5-5M4 21h16" />
    </svg>
  );
}

// 文件卡片：左侧类型标识（ZIP/AUD/VID/DOC 琥珀标签，通用文件细线图标）+ 文件名 + 右侧下载
function FileCard({ path }) {
  const name = path.split('/').pop();
  const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const label = fileIcon(ext);
  return (
    <div className="msg-file">
      {label !== 'FILE' ? (
        <span className="file-icon">{label}</span>
      ) : (
        <span className="file-icon file-icon-generic" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          >
            <path d="M6 2.5h7l5 5V21.5H6z" />
            <path d="M13 2.5v5h5" />
          </svg>
        </span>
      )}
      <div className="file-main">
        <span className="file-name" title={path}>{name}</span>
      </div>
      <a
        className="file-dl"
        href={downloadUrl(path)}
        download
        title="下载"
        aria-label="下载文件"
      >
        <DownloadIcon />
      </a>
    </div>
  );
}

// 单条消息气泡：memo 化，仅内容变化时才重渲染。
// markdown -> HTML 用 useMemo 按 content 缓存；MEDIA/@image/@file 在渲染层统一解析。
const MessageBubble = memo(function MessageBubble({ msg, onImgClick, onCopy }) {
  const isAssistant = msg.role === 'assistant';
  const fileParsed = useMemo(() => parseFileRefs(msg.content), [msg.content]);
  const parsed = useMemo(
    () => (isAssistant ? parseMediaTags(fileParsed.text) : null),
    [isAssistant, fileParsed]
  );
  const html = useMemo(() => (parsed ? renderMd(parsed.text) : ''), [parsed]);
  const time = useMemo(() => formatTime(msg.ts), [msg.ts]);

  if (isAssistant && !msg.content && !msg.images.length) return null;

  return (
    <div className={'msg ' + msg.role}>
      <div className="bubble">
        {/* 消息操作栏：hover 时右上角浮出，只保留复制 */}
        <div className="msg-actions">
          <button className="msg-action" title="复制" onClick={() => onCopy(msg)}>复制</button>
        </div>
        {isAssistant ? (
          <Markdown html={html} />
        ) : (
          <div className="text">
            {fileParsed.text || (msg.images.length || fileParsed.files.length ? '' : '…')}
          </div>
        )}
        {!!msg.images.length && (
          <div className="msg-imgs">
            {msg.images.map((p, j) => (
              <MediaImage
                key={j}
                src={downloadUrl(p)}
                alt="图片"
                onClick={() => onImgClick(p)}
              />
            ))}
          </div>
        )}
        {!!fileParsed.files.length && (
          <div className="msg-imgs">
            {fileParsed.files.map((item, j) => (
              <FileCard key={j} path={item.path} />
            ))}
          </div>
        )}
        {isAssistant && !!parsed && !!parsed.media.length && (
          <div className="msg-imgs">
            {parsed.media.map((item, j) =>
              item.type === 'image' ? (
                <MediaImage
                  key={j}
                  src={downloadUrl(item.path)}
                  alt="图片"
                  onClick={() => onImgClick(item.path)}
                />
              ) : (
                <FileCard key={j} path={item.path} />
              )
            )}
          </div>
        )}
        {time && <div className="msg-time">{time}</div>}
      </div>
    </div>
  );
});

export default function Browse({ active = true }) {
  const [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(null); // 当前浏览的会话 id
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false); // 加载会话列表/切换会话加载态
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false); // 移动端抽屉
  const [lightbox, setLightbox] = useState(null); // 图片预览
  const [toast, setToast] = useState(''); // 轻提示（复制反馈）

  const listRef = useRef(null);
  const currentIdRef = useRef(null); // 切换中的会话 id（竞态守卫）
  const toastTimerRef = useRef(null);

  // 加载会话列表；有会话时自动浏览第一条（或保持当前），无会话显示空态
  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getHistorySessions();
      const list = toSessions(data);
      setSessions(list);
      if (!list.length) {
        currentIdRef.current = null;
        setCurrentId(null);
        setMessages([]);
        return;
      }
      const keep = list.some((s) => s.id === currentIdRef.current);
      const id = keep ? currentIdRef.current : list[0].id;
      currentIdRef.current = id;
      setCurrentId(id);
      try {
        const mdata = await getHistoryMessages(id);
        if (currentIdRef.current !== id) return;
        setMessages(toMessages(mdata));
      } catch (e) {
        if (currentIdRef.current !== id) return;
        setMessages([]);
        setError('加载会话消息失败: ' + e.message);
      }
    } catch (e) {
      setError('加载会话列表失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 切换/加载单个会话的消息
  const switchSession = useCallback(
    async (id) => {
      if (id === currentIdRef.current) return;
      currentIdRef.current = id;
      setCurrentId(id);
      setSidebarOpen(false); // 移动端：选完会话自动收起抽屉
      setLoading(true);
      setError('');
      try {
        const data = await getHistoryMessages(id);
        if (currentIdRef.current !== id) return; // 期间已切走
        setMessages(toMessages(data));
      } catch (e) {
        if (currentIdRef.current !== id) return;
        setMessages([]);
        setError('加载会话消息失败: ' + e.message);
      } finally {
        if (currentIdRef.current === id) setLoading(false);
      }
    },
    []
  );

  // 初始化：加载会话列表
  useEffect(() => {
    loadSessions();
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [loadSessions]);

  // 切回浏览 Tab：display:none 恢复后 scrollTop 被清零，立即瞬时定位底部
  useEffect(() => {
    if (!active) return;
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  }, [active, currentId, messages, loading]);

  // 轻提示：自动消失
  const showToast = useCallback((msg, duration = 2500) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), duration);
  }, []);

  // 复制消息正文（去掉 @file 引用，与渲染层显示一致）
  const handleCopy = useCallback(
    async (msg) => {
      showToast((await writeClipboard(parseFileRefs(msg.content).text)) ? '已复制' : '复制失败');
    },
    [showToast]
  );

  // 代码块复制按钮事件委托：一个监听器覆盖所有动态挂载/卸载的 .md-copy-btn
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const onClick = async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.md-copy-btn') : null;
      if (!btn) return;
      const pre = btn.closest('pre');
      const code = pre && pre.querySelector('code');
      const text = (code ? code.textContent : pre ? pre.textContent : '') || '';
      const ok = await writeClipboard(text);
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => {
        if (btn.isConnected) btn.textContent = '复制';
      }, 1500);
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, []);

  // 预览打开时 Esc 关闭
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const openLightbox = useCallback((p) => setLightbox(p), []);
  const current = sessions.find((s) => s.id === currentId);

  return (
    <div className="chat">
      {/* 会话列表（移动端为左侧抽屉） */}
      <aside className={'sidebar' + (sidebarOpen ? ' open' : '')}>
        <div className="browse-sidebar-head">历史会话</div>
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <div className="session-row">
                <button
                  className={'session-item' + (s.id === currentId ? ' active' : '')}
                  onClick={() => switchSession(s.id)}
                  title={s.title}
                  aria-current={s.id === currentId ? 'true' : undefined}
                >
                  <span className="session-title">{s.title}</span>
                  <span className="session-sub">
                    {s.time ? formatTime(s.time) : '暂无时间'}
                    {s.message_count > 0 ? ` · ${s.message_count} 条` : ''}
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!loading && !sessions.length && <div className="sidebar-empty">暂无历史会话</div>}
      </aside>

      {/* 移动端抽屉遮罩 */}
      {sidebarOpen && <div className="sidebar-mask" onClick={() => setSidebarOpen(false)} />}

      {/* 消息区 */}
      <main className="chat-main">
        {/* 移动端顶栏：汉堡按钮打开会话抽屉 */}
        <div className="mobile-bar">
          <button className="hamburger" onClick={() => setSidebarOpen(true)} title="会话列表" aria-label="打开会话列表">
            ☰
          </button>
          <span className="mobile-title">{current ? current.title : '历史会话'}</span>
        </div>

        {/* 只读提示 */}
        <div className="browse-hint">只读浏览 · 历史会话记录</div>

        <div className="message-list" ref={listRef}>
          {loading && <div className="loading">加载中…</div>}
          {!loading && error && <div className="error">{error}</div>}
          {!loading && !error && !currentId && (
            <div className="browse-empty">暂无历史会话</div>
          )}
          {!loading && !error && currentId && !messages.length && (
            <div className="browse-empty">该会话暂无消息</div>
          )}
          {!loading && !error && messages.map((m, i) => (
            <div className="msg-row" key={m.id || 'k' + i}>
              <MessageBubble
                msg={m}
                onImgClick={openLightbox}
                onCopy={handleCopy}
              />
            </div>
          ))}
        </div>
      </main>

      {/* 图片放大预览（lightbox） */}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <button className="lightbox-close" aria-label="关闭预览" onClick={() => setLightbox(null)}>
            ×
          </button>
          <img className="lightbox-img" src={downloadUrl(lightbox)} alt="图片预览" />
        </div>
      )}

      {/* 轻提示 toast（浏览区内独立定位，避免与顶栏改密 toast 重叠） */}
      {toast && <div className="toast chat-toast">{toast}</div>}
    </div>
  );
}
