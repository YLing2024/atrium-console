import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { uploadFile, downloadUrl } from '../api.js';
import { parseMediaTags } from '../mediaTags.js';
import { parseImageRefs } from '../imageRefs.js';
import { parseFileRefs } from '../fileRefs.js';
import { rpc, ensureConnected, onEvent, onClose, onOpen } from '../ws.js';
import { registerAction } from '../commandActions.js';

// 发送前把图片逐张附加到会话（Hermes 的 image.attach RPC）：图片进入会话
// attached_images，由后续 prompt.submit 自动消费（提交时读取并清空）。
// 任一路径附加失败即抛错，由调用方中止该条消息的发送，避免 AI 缺图。
async function attachImages(paths, sid) {
  for (const path of paths || []) {
    await rpc('image.attach', { session_id: sid, path });
  }
}

// 模块顶层配置：单换行渲染为换行 + GFM（表格/任务列表等）
marked.setOptions({ breaks: true, gfm: true });

// 虚拟列表：未测量前每条消息的估算高度（px）；可视区上/下缓冲的消息数。
// 消息高度不同（长文/代码块/图片），渲染后由 ResizeObserver 实测校正。
const ROW_EST = 80;
const OVERSCAN = 6;

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

// 消息稳定 key：有 id 用 id，否则按索引兜底
function rowKey(m, i) {
  return m.id || 'k' + i;
}

/* ---------- 字段归一化（字段名按 Hermes 网关约定，防御性取值） ---------- */

function toSessions(data) {
  const arr = Array.isArray(data) ? data : (data && (data.sessions || data.list)) || [];
  return arr.map((s) => ({
    id: s.session_id || s.id || s.sessionId || '',
    title: s.title || s.name || s.session_id || s.id || '会话'
  }));
}

// 解析消息时间戳（秒/毫秒/ISO 字符串均可），无则返回 null
function parseTs(m) {
  const raw = m.created_at ?? m.create_time ?? m.timestamp ?? m.time ?? m.createdAt ?? m.when ?? m.ts;
  if (raw == null || raw === '') return null;
  let t;
  if (typeof raw === 'number') t = raw;
  else if (/^\d+$/.test(String(raw))) t = Number(raw);
  else t = new Date(raw).getTime();
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  if (t < 1e12) t *= 1000; // 秒 -> 毫秒
  return t;
}

// 兼容多种 content 形态：字符串 / OpenAI 式数组（{type:'text', text} 等多段）/ 文本字段
function extractContent(m) {
  const c = m.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((p) => p && typeof p === 'object')
      .map((p) => (typeof p.text === 'string' ? p.text : typeof p.content === 'string' ? p.content : ''))
      .filter(Boolean)
      .join('\n');
  }
  return typeof m.text === 'string' ? m.text : '';
}

function toMessages(data) {
  const arr = Array.isArray(data) ? data : (data && (data.messages || data.list)) || [];
  return arr
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const content = extractContent(m);
      // 历史带图消息以文本引用 `@image:/abs/path` 落库（无独立 images 字段）：
      // 解析出路径并入该消息 images（走 .msg-imgs / lightbox 渲染），文本中移除引用。
      const parsed = parseImageRefs(content);
      return {
        id: m.message_id || m.id || '',
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: parsed.text,
        images: (m.image_paths || m.images || []).concat(parsed.images),
        ts: parseTs(m)
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

// 代码块复制按钮：仅挂“复制”按钮（不绑监听），点击由 Chat 层事件委托统一处理。
// 虚拟滚动下按钮随消息动态挂载/卸载，单个委托监听器即可覆盖，避免为每个 <pre> 建监听器。
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

// 文件卡片类型标识：ZIP/AUD/VID/DOC 用琥珀文字标签，通用附件返回 'FILE'（卡片渲染细线图标）
function fileIcon(ext) {
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'apk', 'ipa'].includes(ext)) return 'ZIP';
  if (['mp3', 'm2a', 'wav', 'ogg', 'opus', 'm4a', 'flac'].includes(ext)) return 'AUD';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp'].includes(ext)) return 'VID';
  if (['pdf', 'doc', 'docx', 'odt', 'rtf', 'md', 'txt', 'epub', 'xls', 'xlsx', 'ods', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'DOC';
  return 'FILE';
}

// MEDIA 图片渲染：加载失败（download 接口 400 / 路径不存在）时不显示破图，
// 切换为深色占位；正常图片加载成功照常显示、可点击放大。
// 仅当 <img> 真正触发 error 时才进入占位，流式过程中标签未完整不会误判。
function MediaImage({ src, alt, onClick }) {
  const [failed, setFailed] = useState(false);
  // src 变化（如流式过程中标签逐渐补全）时重置失败态，让新地址正常重试
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

// 待发送预览小图标：细线图片/文件图标（瑞士极简，替代文字/emoji 前缀）
function ChipImageIcon() {
  return (
    <svg
      className="chip-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" />
      <circle cx="5.5" cy="6" r="1.3" />
      <path d="M14.5 10.5L11 7 3 15" />
    </svg>
  );
}

function ChipFileIcon() {
  return (
    <svg
      className="chip-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M4 1.5h5l3 3V14.5H4z" />
      <path d="M9 1.5v3h3" />
    </svg>
  );
}

// 输入区图片图标：细线矩形 + 山 + 太阳
function ComposerImageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 15l-5-5-8 8" />
    </svg>
  );
}

// 输入区附件图标：细线回形针
function ComposerFileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8L12.4 21.4a5 5 0 0 1-7-7L14.8 5a3.3 3.3 0 0 1 4.7 4.7l-9.4 9.4a1.7 1.7 0 0 1-2.4-2.4L15.5 8.5" />
    </svg>
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

// 文件卡片：左侧类型标识（ZIP/AUD/VID/DOC 琥珀标签，通用文件细线图标）+ 文件名 + 右侧下载。
// 卡片共用 .msg-file 样式，user 附件与 assistant MEDIA 文件渲染统一走这里。
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

// 单条消息气泡：memo 化，仅内容/位置/流式状态变化时才重渲染。
// markdown -> HTML 用 useMemo 按 content 缓存，同一 content 只 parse 一次。
// MEDIA: 标签在渲染层统一提取（流式增量 / complete 落定 / resume 历史一致生效）。
const MessageBubble = memo(function MessageBubble({ msg, isLast, streaming, onImgClick, onCopy, onRegenerate, onEdit, onDelete }) {
  const isAssistant = msg.role === 'assistant';
  // @file: 引用解析（发送拼入 / 历史落库都含引用文本）：user/assistant 都处理，
  // 提取文件卡片路径并从文本中移除，不显示 @file: 字样。
  const fileParsed = useMemo(() => parseFileRefs(msg.content), [msg.content]);
  const parsed = useMemo(
    () => (isAssistant ? parseMediaTags(fileParsed.text) : null),
    [isAssistant, fileParsed]
  );
  const html = useMemo(
    () => (parsed ? renderMd(parsed.text) : ''),
    [parsed]
  );
  const time = useMemo(() => formatTime(msg.ts), [msg.ts]);

  // 空内容的助手气泡：流式开头显示闪烁光标，否则不渲染（中断/空回复不残留空盒子）
  if (isAssistant && !msg.content && !msg.images.length) {
    if (!streaming) return null;
    return (
      <div className="msg assistant">
        <div className="bubble typing">▍</div>
      </div>
    );
  }

  return (
    <div className={'msg ' + msg.role}>
      <div className="bubble">
        {/* 消息操作栏：hover 时右上角浮出（system 错误气泡不显示） */}
        {msg.role !== 'system' && (
          <div className="msg-actions">
            <button className="msg-action" title="复制" onClick={() => onCopy(msg)}>复制</button>
            {isAssistant && (
              <button className="msg-action" title="重新生成" onClick={() => onRegenerate(msg)}>重新生成</button>
            )}
            {!isAssistant && (
              <button className="msg-action" title="编辑重发" onClick={() => onEdit(msg)}>编辑</button>
            )}
            <button className="msg-action danger" title="删除" onClick={() => onDelete(msg)}>删除</button>
          </div>
        )}
        {isAssistant ? (
          <Markdown html={html} />
        ) : (
          <div className="text">
            {fileParsed.text || (msg.images.length || fileParsed.files.length ? '' : msg.role === 'user' ? '（空消息）' : '…')}
          </div>
        )}
        {isAssistant && isLast && streaming && <span className="stream-cursor">▍</span>}
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

export default function Chat({ active = true }) {
  const [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(null); // 活动短 id：RPC / 事件过滤
  const [currentStoredId, setCurrentStoredId] = useState(null); // 存储长 id：列表高亮 / 标题
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]); // 待发送图片（上传后的路径）
  const [files, setFiles] = useState([]); // 待发送附件（上传后的路径）
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false); // 切换会话加载态
  const [wsStatus, setWsStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false); // 移动端抽屉
  const [lightbox, setLightbox] = useState(null); // 图片预览
  const [showScrollBtn, setShowScrollBtn] = useState(false); // 回到底部按钮
  const [pendingQueue, setPendingQueue] = useState([]); // 流式中排队待发送的 user 消息
  const [busy, setBusy] = useState(false); // 是否有 prompt.submit 在途（防止重复提交）
  const [toast, setToast] = useState(''); // 轻提示（中断后继续发送队列等）
  const [dragOver, setDragOver] = useState(false); // 拖拽上传中的高亮遮罩
  const [ctxMenu, setCtxMenu] = useState(null); // 会话右键/更多菜单 { sid, x, y }
  const [titleOverrides, setTitleOverrides] = useState({}); // 本地重命名的会话标题（防刷新覆盖）
  const [renamingId, setRenamingId] = useState(null); // 正在内联重命名的会话 id
  const [renameValue, setRenameValue] = useState(''); // 重命名输入框当前值

  const listRef = useRef(null);
  const fileRef = useRef(null);
  // 虚拟列表：scrollTop / 视口高度 / 测量版本号；实测行高与行级 ResizeObserver 缓存
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [measureTick, setMeasureTick] = useState(0);
  const rowHeightsRef = useRef(new Map());
  const rowObsRef = useRef(new Map());
  const scrollRafRef = useRef(0);
  const imgRef = useRef(null);
  const inputRef = useRef(null); // 输入框（发送后保持焦点，便于连续输入排队）
  const renameInputRef = useRef(null); // 会话标题内联重命名输入框
  const everReadyRef = useRef(false); // 是否曾连上过（区分“首次连接”与“断线重连”）
  const pendingQueueRef = useRef([]); // 队列同步 ref：事件/异步回调中读取最新值
  const busyRef = useRef(false); // busy 同步 ref
  const toastTimerRef = useRef(null); // toast 自动消失定时器
  const localIdMapRef = useRef({}); // storedId(长) -> sessionId(短)：本地新建未持久化会话映射
  const draftTimerRef = useRef(null); // 草稿防抖定时器
  const submitPromptRef = useRef(null); // submitPrompt 稳定引用（供稳定回调复用，避免破坏 MessageBubble memo）

  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const currentStoredIdRef = useRef(currentStoredId);
  currentStoredIdRef.current = currentStoredId;
  const activeRef = useRef(active);
  activeRef.current = active;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  const titleOverridesRef = useRef(titleOverrides);
  titleOverridesRef.current = titleOverrides;
  const showScrollBtnRef = useRef(false);
  const stickToBottomRef = useRef(true); // 是否钉在底部：新内容到达时自动跟随（用户上翻阅读时不打扰）
  const externalPollRef = useRef(null); // 外部消息（微信等）回复轮询定时器

  // 停止外部消息回复轮询（切会话 / 新通知 / 轮询达成停止条件时调用）
  const stopExternalPoll = useCallback(() => {
    if (externalPollRef.current) {
      clearInterval(externalPollRef.current);
      externalPollRef.current = null;
    }
  }, []);

  // 刷新当前会话消息（session.resume）：成功且仍处于该会话时写回消息与短 id，可选回调观察结果
  const resumeCurrent = useCallback((storedId, cb) => {
    rpc('session.resume', { session_id: storedId })
      .then((data) => {
        if (currentStoredIdRef.current !== storedId) return;
        const newId = data && (data.session_id || data.sessionId || data.resumed || storedId);
        if (newId && newId !== currentIdRef.current) {
          setCurrentId(newId);
          currentIdRef.current = newId;
        }
        const list = toMessages(data.messages || data);
        setMessages(list);
        if (cb) cb(data, list);
      })
      .catch(() => {});
  }, []);

  // 刷新当前会话消息（session.resume → setMessages）：sessions.changed / external_message 共用。
  // 仅当前存在会话（currentStoredIdRef 非空）时生效；流式/忙碌守卫由调用方负责。
  const refreshCurrentSession = useCallback(() => {
    const storedId = currentStoredIdRef.current;
    if (!storedId) return;
    resumeCurrent(storedId);
  }, [resumeCurrent]);

  // 启动轮询等待外部消息（微信）回复落定：每 2.5s resume 一次。
  // 微信回复的流式在 gateway，Web 端不可见，轮询直接刷新即可。
  // 停止条件：最后一条消息是 assistant 且非流式（无 streaming 标记），或 30 秒上限（12 次）。
  const startExternalPoll = useCallback((storedId) => {
    stopExternalPoll(); // 新通知重复触发时先停止旧轮询
    let count = 0;
    const tick = () => {
      if (count >= 12 || currentStoredIdRef.current !== storedId) return stopExternalPoll();
      count++;
      resumeCurrent(storedId, (data, list) => {
        const rawArr = Array.isArray(data) ? data : (data && (data.messages || data.list)) || [];
        const lastRaw = rawArr[rawArr.length - 1];
        const last = list[list.length - 1];
        const streamingMarked =
          !!lastRaw &&
          (lastRaw.streaming || lastRaw.is_streaming || lastRaw.isStreaming || lastRaw.status === 'streaming');
        // 最后一条已是 assistant 且无流式标记：回复已落定，停止轮询
        if (last && last.role === 'assistant' && !streamingMarked) stopExternalPoll();
      });
    };
    externalPollRef.current = setInterval(tick, 2500);
  }, [resumeCurrent, stopExternalPoll]);

  const scrollToBottom = useCallback((smooth) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // 自动定位：切换会话 / resume 历史 / 新消息 / 流式增量 → 一律瞬时（behavior:'auto'，无动画）。
  // 仅当用户本就钉在底部时自动跟随；用户上翻阅读时不动，由“回到底部”按钮接管。
  // useLayoutEffect：在绘制前定位，避免切换会话/历史加载时先闪一帧顶部内容再跳到底部。
  // measureTick：虚拟列表行高实测/校正后 scrollHeight 变化，钉底时重新对齐真正的底部。
  useLayoutEffect(() => {
    if (!messages.length || !stickToBottomRef.current) return;
    scrollToBottom(false);
  }, [messages, scrollToBottom, measureTick]);

  // 切回聊天 Tab：display:none 恢复后 scrollTop 被清零，立即瞬时定位底部（无滚动动画）。
  useLayoutEffect(() => {
    if (!active) return;
    stickToBottomRef.current = true;
    scrollToBottom(false);
  }, [active, scrollToBottom]);

  const openLightbox = useCallback((p) => setLightbox(p), []);

  // 预览打开时 Esc 关闭
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  // 滚动监听：更新“是否钉在底部”，并同步 scrollTop 驱动虚拟列表切片。
  // scrollTop 走 rAF 节流，避免每帧 setState 造成额外渲染，保证滚动流畅。
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottomRef.current = nearBottom;
    if (nearBottom !== showScrollBtnRef.current) {
      showScrollBtnRef.current = nearBottom;
      setShowScrollBtn(!nearBottom);
    }
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      setScrollTop(el.scrollTop);
    });
  }, []);

  // 视口高度：ResizeObserver 跟随容器尺寸（含移动端/窗口变化），供可见区间计算
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setViewH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 虚拟列表切片：按已测行高累计偏移，二分/线性定位可见区间，上下各留 OVERSCAN 缓冲。
  // useMemo 依赖 scrollTop/viewH/measureTick，滚动与行高变化时仅重算，不重渲染全部消息。
  const layout = useMemo(() => {
    const n = messages.length;
    const offsets = new Array(n + 1);
    offsets[0] = 0;
    for (let i = 0; i < n; i++) {
      offsets[i + 1] = offsets[i] + (rowHeightsRef.current.get(rowKey(messages[i], i)) ?? ROW_EST);
    }
    const total = offsets[n];
    const vh = Math.max(viewH, 1);
    let start = 0;
    while (start < n && offsets[start + 1] <= scrollTop) start++;
    start = Math.max(0, start - OVERSCAN);
    let end = start;
    while (end < n && offsets[end + 1] < scrollTop + vh) end++;
    end = Math.min(n - 1, end + OVERSCAN);
    return {
      topPad: offsets[start],
      bottomPad: total - offsets[end + 1],
      start,
      end
    };
  }, [messages, scrollTop, viewH, measureTick]);

  // 行高实测：resize 时（含图片加载、流式长高）更新缓存并触发切片重算。
  // 卸载时断开对应 ResizeObserver，重新挂载时复用/重建。
  const measureRow = useCallback((el, key) => {
    if (el) {
      let ro = rowObsRef.current.get(key);
      if (!ro) {
        ro = new ResizeObserver(() => {
          const h = el.offsetHeight;
          if (Math.abs((rowHeightsRef.current.get(key) || 0) - h) > 1) {
            rowHeightsRef.current.set(key, h);
            setMeasureTick((t) => t + 1);
          }
        });
        rowObsRef.current.set(key, ro);
        ro.observe(el);
      }
      const h = el.offsetHeight;
      if (Math.abs((rowHeightsRef.current.get(key) || 0) - h) > 1) {
        rowHeightsRef.current.set(key, h);
        setMeasureTick((t) => t + 1);
      }
    } else {
      const ro = rowObsRef.current.get(key);
      if (ro) {
        ro.disconnect();
        rowObsRef.current.delete(key);
      }
    }
  }, []);

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

  // 卸载清理：滚动 rAF、行 ResizeObserver 与外部消息轮询
  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      rowObsRef.current.forEach((ro) => ro.disconnect());
      rowObsRef.current.clear();
      stopExternalPoll();
    };
  }, [stopExternalPoll]);

  // 输入框自动增高：多行草稿时随内容增长（最高 140px，超出后内部滚动）；发送清空后自动回落
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [input]);

  // 收到回复后总是刷新会话列表：新会话在 session.create 时可能尚未持久化（占位项），
  // 首次对话完成后才落库。刷新时合并保留未持久化的占位项，同 id 的真实项自然替换占位
  // （toSessions 的项无 local 标记），标题同步为真实标题。
  const refreshSessions = useCallback(() => {
    const sid = currentStoredIdRef.current;
    if (!sid) return;
    rpc('session.list')
      .then((list) => {
        if (currentStoredIdRef.current !== sid) return; // 期间用户又切走了
        const fresh = toSessions(list);
        const locals = sessionsRef.current.filter((s) => s.local && !fresh.some((f) => f.id === s.id));
        // 合并本地重命名覆盖：用户 prompt 改过的标题优先于服务端默认标题
        const overrides = titleOverridesRef.current;
        const next = [...locals, ...fresh].map((s) =>
          overrides[s.id] ? { ...s, title: overrides[s.id] } : s
        );
        const cur = sessionsRef.current;
        // 与当前一致（同长度、同顺序、同标题、同占位标记）则跳过，避免多余渲染/死循环
        if (
          cur.length === next.length &&
          cur.every((s, i) => s.id === next[i].id && s.title === next[i].title && !!s.local === !!next[i].local)
        ) {
          return;
        }
        setSessions(next);
      })
      .catch(() => {});
  }, []);

  // 初始化：连接 WS -> 订阅事件 -> 加载会话。
  // onEvent/onClose/onOpen 在 ensureConnected 之前订阅：即使首次连接失败，
  // ws.js 的指数退避重连成功后会触发 onOpen，这里能自动恢复而不必整页刷新。
  useEffect(() => {
    let alive = true;
    let offEvent = null;
    let offClose = null;
    let offOpen = null;
    let sessionsLoaded = false; // 会话列表是否已成功加载（重连后不重复加载）

    // 首次加载会话列表：成功后由会话的 start/complete 事件驱动后续状态
    function loadSessions() {
      if (sessionsLoaded || !alive) return;
      sessionsLoaded = true; // 防重复；失败时回退，重连成功后重试
      rpc('session.list')
        .then((data) => {
          if (!alive) return;
          const list = toSessions(data);
          setSessions(list);
          if (list.length) {
            switchSession(list[0].id);
          } else {
            createSession(); // 没有会话则新建一个
          }
        })
        .catch((e) => {
          if (!alive) return;
          sessionsLoaded = false;
          setError('加载会话失败: ' + e.message);
        });
    }

    // 连接建立（首次成功或断线重连成功）
    function handleOpen() {
      if (!alive) return;
      everReadyRef.current = true;
      setWsStatus('ready');
      setError('');
      loadSessions();
    }

    // 先订阅再连接：断线/重连的 UI 恢复由事件驱动，不依赖一次 init 是否成功
    offEvent = onEvent(handleEvent);
    offClose = onClose(() => {
      // 断线：解除流式/忙碌锁，避免回复中断后 UI 永久锁死（重连后 message.complete 不会再送达）
      setWsStatus('connecting');
      setStreaming(false);
      streamingRef.current = false;
      setBusy(false);
      busyRef.current = false;
    });
    offOpen = onOpen(handleOpen);

    ensureConnected()
      .then(() => {
        if (!alive) return;
        handleOpen();
      })
      .catch((e) => {
        if (alive) setError('连接失败: ' + e.message + '，正在自动重连…');
      });

    return () => {
      alive = false;
      offEvent && offEvent();
      offClose && offClose();
      offOpen && offOpen();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 事件处理：流式追加到当前会话
  // Hermes 网关事件帧：{ jsonrpc, method: 'event', params: { type, session_id, payload } }
  const handleEvent = useCallback(
    (msg) => {
      const { method, params = {} } = msg;
      if (method && method !== 'event') return; // 只处理网关事件帧（method 恒为 'event'）
      const type = params.type || '';
      const payload = params.payload || {};

      // gateway.ready：连接（含重连）成功后恢复状态
      if (type === 'gateway.ready') {
        everReadyRef.current = true;
        setWsStatus('ready');
        return;
      }

      // admin.external_message：admin-server 广播的微信等外部平台新消息（独立处理，不走流式逻辑）
      if (type === 'admin.external_message') {
        const text = typeof payload.text === 'string' ? payload.text : '';
        const plat =
          typeof payload.platform === 'string' && payload.platform ? payload.platform : '微信';
        showToast(`「${plat}」收到新消息：${text.slice(0, 40) || '（无文本消息）'}`, 4000);
        if (!activeRef.current) return; // 不在聊天 Tab：仅提示，不刷新
        const chatId = payload.chat_id;
        // chat_id 匹配：为空 / 当前存储长 id 包含 chat_id（微信 chat_id 是 session key 的一部分）
        const isCurrent =
          !chatId || (!!currentStoredIdRef.current && currentStoredIdRef.current.includes(chatId));
        if (!isCurrent) {
          refreshSessions(); // 其他会话：只刷新会话列表
          return;
        }
        // 当前会话：立即刷新历史（复用 refreshCurrentSession）+ 启动轮询等待微信回复落定。
        // 流式/提交中不立即刷新，避免覆盖进行中的流式气泡；轮询直接刷（微信流式在 gateway，Web 端不可见）
        const storedId = currentStoredIdRef.current;
        if (!storedId) return;
        if (!streamingRef.current && !busyRef.current) {
          refreshCurrentSession();
        }
        startExternalPoll(storedId); // 每 2.5s 一次，回复落定或 30s（12 次）后停止
        return;
      }

      // sessions.changed：Hermes serve 在会话变化时广播（用户消息/回复完成归一化触发，2 秒合并）。
      // 当前会话非流式 → refreshCurrentSession() 刷新消息；流式中不刷，避免打断自身流式。
      if (type === 'sessions.changed') {
        if (streamingRef.current || busyRef.current) return;
        refreshCurrentSession();
        return;
      }

      const sid = params.session_id || params.session || currentIdRef.current;
      if (sid && sid !== currentIdRef.current) return; // 非当前会话的消息忽略

      if (type === 'message.start') {
        // params 无 message_id：始终追加一个空的 assistant 气泡
        setMessages((prev) => [
          ...prev,
          { id: '', role: 'assistant', content: '', images: [], ts: Date.now() }
        ]);
        setStreaming(true);
        streamingRef.current = true;
      } else if (type === 'message.delta') {
        // 文本增量在 params.payload.text
        const text = payload.text ?? params.text ?? params.delta ?? params.content ?? '';
        if (!text) return;
        setMessages((prev) => {
          const copy = prev.slice();
          let idx = copy.length - 1;
          // 定位正在流式的助手气泡：其后可能有排队的 user 消息，不能更新绝对最后一条
          while (idx >= 0 && copy[idx].role !== 'assistant') idx--;
          if (idx < 0) return prev;
          copy[idx] = { ...copy[idx], content: copy[idx].content + text };
          return copy;
        });
      } else if (type === 'message.complete') {
        // 完整文本在 params.payload.text：回复结束的最终落定，替换当前流式内容
        try {
          const text = payload.text ?? params.text ?? params.content ?? '';
          const paths = payload.image_paths || params.image_paths || [];
          setMessages((prev) => {
            const copy = prev.slice();
            let idx = copy.length - 1;
            while (idx >= 0 && copy[idx].role !== 'assistant') idx--;
            if (idx < 0) return prev;
            const next = { ...copy[idx] };
            if (typeof text === 'string' && text) next.content = text;
            if (Array.isArray(paths) && paths.length) next.images = next.images.concat(paths);
            copy[idx] = next;
            return copy;
          });
          refreshSessions();
        } finally {
          settleReply(); // 无论落定逻辑是否异常，都必须复位流式状态并接管队列
        }
      } else if (type === 'message.error' || type === 'error') {
        try {
          const em = payload.message ?? params.message ?? '回复出错';
          setMessages((prev) => [
            ...prev,
            { id: 'err-' + Date.now(), role: 'system', content: em, images: [], ts: Date.now() }
          ]);
        } finally {
          settleReply();
        }
      }
    },
    [refreshSessions, refreshCurrentSession, startExternalPoll]
  );

  // 轻提示：自动消失（可选时长，默认 2500ms）
  const showToast = useCallback((msg, duration = 2500) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), duration);
  }, []);

  // 卸载时清理 toast 定时器，避免卸载后 setToast 触发 React 警告/内存泄漏
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  // 提交 prompt：Hermes 的 prompt.submit 是非阻塞 ack（返回 {"status":"streaming"}），
  // agent 在后台线程跑，回复经 WS 事件流推送。busy 标志覆盖 RPC 在途期间，防止重复提交。
  async function submitPrompt(userMsg, sid) {
    setBusy(true);
    busyRef.current = true;
    let failed = false;
    try {
      // 发送前逐张 image.attach（队列 flush 路径同样经此，统一在 submit 前 attach）。
      // prompt.submit 的 image_paths 参数网关忽略，不再传，图片靠 attached_images 自动消费。
      try {
        await attachImages(userMsg.images, sid);
      } catch (e) {
        throw new Error('图片附加失败: ' + e.message);
      }
      await rpc('prompt.submit', {
        session_id: sid,
        text: userMsg.content
      });
    } catch (e) {
      // 发送失败（含图片附加失败中止）：仅在仍处于该会话时补错误气泡（期间可能已切换会话）
      if (currentIdRef.current === sid) {
        failed = true;
        setMessages((prev) => [
          ...prev,
          {
            id: 'err-' + Date.now(),
            role: 'system',
            content: '发送失败: ' + e.message,
            images: [],
            ts: Date.now()
          }
        ]);
      }
    } finally {
      setBusy(false);
      busyRef.current = false;
      if (failed) {
        // 发送失败：视为一次回复结束，立即继续消费队列
        settleReply();
      } else {
        // 成功 ack：接管队列。关键场景是 ack 晚于 message.complete 到达——
        // 此时 settleReply 里的 flushQueue 因 busyRef 仍为 true 被拦截，
        // busy 复位后若不在此补一次 flushQueue，队列会永久卡死。
        // streamingRef/busyRef 守卫可防止重复或提前发送。
        flushQueue();
      }
    }
  }
  // 供稳定回调（handleRegenerate 等）复用最新 submitPrompt，避免破坏 MessageBubble memo
  submitPromptRef.current = submitPrompt;

  // 复制文本到剪贴板：写剪贴板逻辑统一走 writeClipboard（代码块复制按钮事件委托也用它）
  const copyText = useCallback(async (text) => {
    showToast((await writeClipboard(text)) ? '已复制' : '复制失败');
  }, [showToast]);

  // 命令面板可执行的聊天动作：新建会话 / 复制当前会话ID。
  // 用 ref 保证稳定注册（createSession/copyText 每次渲染都是新函数），卸载时注销
  const createSessionRef = useRef(null);
  const copyTextRef = useRef(null);
  createSessionRef.current = createSession;
  copyTextRef.current = copyText;
  useEffect(() => {
    const unNew = registerAction('newSession', () => createSessionRef.current());
    const unCopy = registerAction('copySessionId', () => {
      copyTextRef.current(currentStoredIdRef.current || currentIdRef.current || '');
    });
    return () => {
      unNew();
      unCopy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 复制消息正文（去掉 @file 引用，与渲染层显示一致）
  const handleCopy = useCallback((msg) => {
    copyText(parseFileRefs(msg.content).text);
  }, [copyText]);

  // 重新生成：删除该条 assistant 消息及其后的消息，重发其前一条 user prompt
  const handleRegenerate = useCallback((msg) => {
    const list = messagesRef.current;
    const idx = list.findIndex((m) => m === msg);
    if (idx < 0) return;
    if (streamingRef.current && currentIdRef.current) {
      rpc('session.interrupt', { session_id: currentIdRef.current }).catch(() => {});
    }
    setStreaming(false);
    streamingRef.current = false;
    pendingQueueRef.current = [];
    setPendingQueue([]);
    const trimmed = list.slice(0, idx);
    setMessages(trimmed);
    let userMsg = null;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i].role === 'user') { userMsg = trimmed[i]; break; }
    }
    if (!userMsg) {
      showToast('未找到可重发的消息');
      return;
    }
    setStreaming(true);
    streamingRef.current = true;
    submitPromptRef.current({ ...userMsg, id: 'local-' + Date.now(), ts: Date.now() }, currentIdRef.current);
  }, [showToast]);

  // 编辑重发：回填正文到输入框并删除该条消息及其后消息，修改后发送即替换原消息
  const handleEdit = useCallback((msg) => {
    const list = messagesRef.current;
    const idx = list.findIndex((m) => m === msg);
    if (idx < 0) return;
    if (streamingRef.current && currentIdRef.current) {
      rpc('session.interrupt', { session_id: currentIdRef.current }).catch(() => {});
    }
    setStreaming(false);
    streamingRef.current = false;
    pendingQueueRef.current = [];
    setPendingQueue([]);
    setMessages(list.slice(0, idx));
    const parsed = parseFileRefs(msg.content);
    setInput(parsed.text);
    setImages(msg.images ? msg.images.slice() : []);
    setFiles(parsed.files.map((f) => f.path));
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // 删除消息（本地）：仅从当前视图移除，不会影响服务器数据，删除前明确提示
  const handleDelete = useCallback((msg) => {
    const ok = window.confirm(
      '删除此消息仅从当前视图移除（本地），不会影响服务器数据。确定删除？'
    );
    if (!ok) return;
    setMessages((prev) => prev.filter((m) => m !== msg));
  }, []);

  // 草稿保存：读取输入框当前值写入当前会话 key（无内容则删除）
  const saveDraft = useCallback(() => {
    const key = currentStoredIdRef.current || currentIdRef.current;
    if (!key) return;
    const val = inputRef.current ? inputRef.current.value : '';
    if (val) localStorage.setItem('chat_draft_' + key, val);
    else localStorage.removeItem('chat_draft_' + key);
  }, []);

  // 输入防抖写草稿（400ms），切会话/卸载由下方显式 saveDraft 兜底
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(saveDraft, 400);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [input, saveDraft]);

  // 切换会话/刷新后恢复该会话草稿
  useEffect(() => {
    const key = currentStoredId || currentId;
    if (!key) return;
    const val = localStorage.getItem('chat_draft_' + key);
    setInput(val || '');
  }, [currentStoredId, currentId]);

  // 页面隐藏/卸载前兜底保存一次，避免最后几秒输入丢失
  useEffect(() => {
    const flush = () => saveDraft();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      saveDraft();
    };
  }, [saveDraft]);

  // 会话右键/更多按钮菜单
  function openSessionMenu(e, s) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ sid: s.id, x: e.clientX, y: e.clientY });
  }

  // 菜单显示时点击任意处 / 失焦关闭
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [ctxMenu]);

  // 内联重命名会话：标题就地变成输入框，Enter 保存 / Esc 取消
  function startRename(sid) {
    const s = sessionsRef.current.find((x) => x.id === sid);
    setRenameValue(s ? s.title : '');
    setRenamingId(sid);
    setCtxMenu(null);
    // 输入框渲染后再聚焦并全选，方便直接输入覆盖
    setTimeout(() => {
      const el = renameInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }, 0);
  }

  // 保存重命名：空值视为取消（保留原标题）
  function commitRename() {
    const sid = renamingId;
    if (!sid) return;
    const trimmed = (renameValue || '').trim();
    if (trimmed) {
      setTitleOverrides((prev) => ({ ...prev, [sid]: trimmed }));
      setSessions((prev) => prev.map((x) => (x.id === sid ? { ...x, title: trimmed } : x)));
    }
    setRenamingId(null);
    setRenameValue('');
  }

  // 取消重命名（Esc）
  function cancelRename() {
    setRenamingId(null);
    setRenameValue('');
  }

  // 删除会话（本地从列表移除），当前会话被删则切到剩余第一条或空态
  function deleteSession(sid) {
    const s = sessionsRef.current.find((x) => x.id === sid);
    if (
      !window.confirm(
        `删除会话「${s ? s.title : ''}」仅从当前视图移除（本地），不会影响服务器数据。确定删除？`
      )
    )
      return;
    setCtxMenu(null);
    setSessions((prev) => prev.filter((x) => x.id !== sid));
    localStorage.removeItem('chat_draft_' + sid);
    delete localIdMapRef.current[sid];
    if (currentStoredIdRef.current === sid) {
      const rest = sessionsRef.current.filter((x) => x.id !== sid);
      if (rest.length) switchSession(rest[0].id);
      else {
        setCurrentStoredId(null);
        currentStoredIdRef.current = null;
        setCurrentId(null);
        currentIdRef.current = null;
        setMessages([]);
        setInput('');
      }
    }
  }

  // 会话显示标题：本地重命名优先
  const getTitle = (sid) => {
    const s = sessions.find((x) => x.id === sid);
    return s ? titleOverrides[s.id] || s.title : '新会话';
  };

  // 统一上传：复用 onPick 的上传逻辑（图片/文件按 mime 归类，拖拽/粘贴共用）
  async function uploadFiles(list, kind) {
    for (const f of list) {
      try {
        const { path } = await uploadFile(f);
        const isImage = kind === 'image' || f.type.startsWith('image/');
        if (isImage) setImages((prev) => [...prev, path]);
        else setFiles((prev) => [...prev, path]);
      } catch (err) {
        setError('上传失败: ' + err.message);
      }
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      setDragOver(true);
    }
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    uploadFiles(files);
    showToast(`已添加 ${files.length} 个文件`);
  }

  // textarea 粘贴图片：自动上传（复用上传逻辑），不拦截文本粘贴
  function handlePaste(e) {
    const cd = e.clipboardData;
    if (!cd || !cd.items) return;
    const imgs = [];
    for (const it of cd.items) {
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (!imgs.length) return;
    e.preventDefault();
    uploadFiles(imgs, 'image');
    showToast(`已粘贴 ${imgs.length} 张图片`);
  }

  // 选择并上传文件/图片（复用 uploadFiles）
  function onPick(e, kind) {
    uploadFiles(Array.from(e.target.files || []), kind);
    e.target.value = '';
  }

  // 队列非空且空闲时，取第一条发送（FIFO）。同一时间只允许一个 prompt.submit 在途。
  function flushQueue() {
    if (busyRef.current) return; // 已有提交在途，稍后由它的收尾逻辑接管
    if (streamingRef.current) return; // 回复仍在进行
    const q = pendingQueueRef.current;
    if (!q.length) return;
    const next = q[0];
    pendingQueueRef.current = q.slice(1);
    setPendingQueue(pendingQueueRef.current);
    setStreaming(true);
    streamingRef.current = true;
    submitPrompt(next, currentIdRef.current);
  }

  // 一次回复结束（message.complete / message.error / 中断 / 发送失败）的统一收尾：
  // 恢复空闲态；若队列非空则自动发送下一条。
  function settleReply() {
    setStreaming(false);
    streamingRef.current = false;
    flushQueue();
  }

  // 切换会话：list 返回的是 stored_session_id（长格式），需 resume 激活并拿到活动短 session_id。
  // 高亮/标题用 currentStoredId，RPC/事件用 currentId，两者分开记录。
  async function switchSession(id) {
    // 队列有未发送消息：提示切换将取消这些排队消息（取消则不切换）
    const queued = pendingQueueRef.current.length;
    if (queued > 0) {
      const ok = window.confirm(
        `有 ${queued} 条消息排队中，切换会话将取消。确定切换？`
      );
      if (!ok) return;
    }
    setLoading(true);
    setError('');
    saveDraft(); // 离开前把当前会话草稿落盘，防切换丢失
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    // 当前会话正在生成时先中断，避免切走后回复仍写入旧会话 / 事件串台
    if (streamingRef.current && currentIdRef.current) {
      try {
        await rpc('session.interrupt', { session_id: currentIdRef.current });
      } catch {
        /* 中断失败可忽略 */
      }
    }
    setStreaming(false);
    streamingRef.current = false;
    pendingQueueRef.current = [];
    setPendingQueue([]);
    setBusy(false);
    busyRef.current = false;
    stopExternalPoll(); // 切换会话：停止旧的微信回复轮询
    setSidebarOpen(false); // 移动端：选完会话自动收起抽屉
    stickToBottomRef.current = true; // 切会话后历史落到底部
    const prevStoredId = currentStoredIdRef.current;
    setCurrentStoredId(id);
    currentStoredIdRef.current = id; // 同步 ref，高亮立即生效
    // 本地新建未持久化会话：跳过 resume（长 id 查库必失败），直接用短 id 空会话
    const localShort = localIdMapRef.current[id];
    if (localShort) {
      setCurrentId(localShort);
      currentIdRef.current = localShort;
      setMessages([]);
      setLoading(false);
      return;
    }
    try {
      const data = await rpc('session.resume', { session_id: id });
      if (currentStoredIdRef.current !== id) return; // 期间用户又切走了
      const newId = data && (data.session_id || data.sessionId || data.resumed || id);
      setCurrentId(newId);
      setMessages(toMessages(data.messages || data));
      setLoading(false);
    } catch (e) {
      if (currentStoredIdRef.current !== id) return;
      // resume 失败兜底：可能是未持久化新会话（映射里有短 id）→ 按空会话处理
      const fallbackShort = localIdMapRef.current[id];
      if (fallbackShort) {
        setCurrentId(fallbackShort);
        currentIdRef.current = fallbackShort;
        setMessages([]);
        setLoading(false);
        return;
      }
      // 恢复原会话高亮与消息，避免停留在失败会话的错误状态
      setCurrentStoredId(prevStoredId);
      currentStoredIdRef.current = prevStoredId;
      setLoading(false);
      setError('加载历史失败: ' + e.message);
    }
  }

  // 新建会话
  async function createSession() {
    setError('');
    saveDraft(); // 离开前把当前会话草稿落盘，防切换丢失
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    setSidebarOpen(false); // 移动端：建完会话收起抽屉
    stickToBottomRef.current = true;
    setLoading(true);
    setStreaming(false);
    streamingRef.current = false;
    pendingQueueRef.current = [];
    setPendingQueue([]);
    setBusy(false);
    busyRef.current = false;
    try {
      const data = await rpc('session.create');
      const shortId = data && (data.session_id || data.sessionId || data.id);
      // session_key 优先：与持久化后 session.list 的 id 同格式同值，占位项可被真实项同 id 替换
      const storedId = data && (data.session_key || data.stored_session_id || shortId);
      const list = await rpc('session.list');
      const l = toSessions(list);
      // 从最新 list 里找新会话 id 同步高亮（新会话首次发消息前可能尚未持久化，找不到则用返回的 id）
      const found = storedId && l.find((s) => s.id === storedId);
      // 未持久化：本地插入占位项到列表最前，保证侧边栏立即可见
      const fresh = found ? l : storedId ? [{ id: storedId, title: '新会话', local: true }, ...l] : l;
      // 保留此前尚未持久化的其他占位项
      const locals = sessionsRef.current.filter((s) => s.local && !fresh.some((f) => f.id === s.id));
      setSessions([...locals, ...fresh]);
      const sid = (found && found.id) || storedId || null;
      setCurrentStoredId(sid);
      currentStoredIdRef.current = sid;
      setCurrentId(shortId || sid);
      // 记录映射：新会话未持久化前 resume(长id) 会失败，切换时用短 id 直接走空会话
      if (storedId && shortId) localIdMapRef.current[storedId] = shortId;
      setMessages([]);
      setStreaming(false);
    } catch (e) {
      setError('创建会话失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  // 发送消息：先上传图片/附件（上传在 onPick 完成），再提交 prompt。
  // 流式中发送不再被拦截：消息立即上屏，若回复进行中则进入队列，完成后自动依次发出。
  function send() {
    const text = input.trim();
    if ((!text && !images.length && !files.length) || !currentId) return;
    setError('');

    const sentImages = images.slice();
    const sentFiles = files.slice();
    // 文件以 `@file:<绝对路径>` 引用拼进 submit text（多个换行分隔，替代原来的 [附件] 明文）：
    // agent 的文件工具据此读取服务器文件；引用同时作为历史持久化格式，resume 后可解析回文件卡片。
    // 路径为空的条目跳过并提示（文件走 admin-server 上传返回绝对路径，与网关同机可读）。
    const validFiles = sentFiles.filter(Boolean);
    if (validFiles.length !== sentFiles.length) showToast('部分文件路径无效，已跳过');
    const fileRefs = validFiles.map((p) => `@file:${p}`).join('\n');
    const submitText = fileRefs ? (text ? `${text}\n${fileRefs}` : fileRefs) : text;
    const userMsg = {
      id: 'local-' + Date.now(),
      role: 'user',
      content: submitText,
      images: sentImages.slice(),
      ts: Date.now()
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setImages([]);
    setFiles([]);
    // 发送成功后清空该会话草稿，避免刷新后旧草稿被恢复
    const draftKey = currentStoredIdRef.current || currentIdRef.current;
    if (draftKey) localStorage.removeItem('chat_draft_' + draftKey);
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    stickToBottomRef.current = true; // 用户主动发送：无论之前是否上翻，都滚到底部看到自己的消息

    if (streamingRef.current || busyRef.current) {
      // 流式中（或已有提交在途）：入队，等待当前回复结束后自动发送（FIFO）
      pendingQueueRef.current.push(userMsg);
      setPendingQueue(pendingQueueRef.current.slice());
    } else {
      // 空闲：立即提交
      setStreaming(true);
      streamingRef.current = true;
      submitPrompt(userMsg, currentIdRef.current);
    }
    // 发送后保持输入框焦点，便于连续输入排队
    if (inputRef.current) inputRef.current.focus();
  }

  // 中断当前回复：成功后若队列非空自动继续发下一条（toast 提示）
  async function interrupt() {
    if (!currentId) return;
    setStreaming(false);
    streamingRef.current = false;
    try {
      await rpc('session.interrupt', { session_id: currentId });
    } catch (e) {
      /* 中断失败可忽略 */
    }
    const n = pendingQueueRef.current.length;
    if (n > 0) showToast(`已中断，继续发送 ${n} 条排队消息`);
    flushQueue();
  }

  return (
    <div className="chat">
      {/* 会话列表（移动端为左侧抽屉） */}
      <aside className={'sidebar' + (sidebarOpen ? ' open' : '')}>
        <button className="new-session" onClick={createSession} disabled={loading}>
          + 新建会话
        </button>
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <div className="session-row">
                {renamingId === s.id ? (
                  <input
                    ref={renameInputRef}
                    className="input session-rename"
                    value={renameValue}
                    placeholder="会话标题"
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      // 中文输入法（IME）组合期间 Enter 是选词确认，不提交
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <>
                    <button
                      className={'session-item' + (s.id === currentStoredId ? ' active' : '')}
                      onClick={() => switchSession(s.id)}
                      onContextMenu={(e) => openSessionMenu(e, s)}
                      title={titleOverrides[s.id] || s.title}
                      aria-current={s.id === currentStoredId ? 'true' : undefined}
                    >
                      {titleOverrides[s.id] || s.title}
                    </button>
                    <button
                      className="session-more"
                      title="会话操作"
                      aria-label="会话操作"
                      onClick={(e) => openSessionMenu(e, s)}
                    >
                      ⋯
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* 会话右键/更多菜单：重命名 / 删除（本地） */}
      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button className="ctx-item" onClick={() => startRename(ctxMenu.sid)}>重命名</button>
          <button className="ctx-item danger" onClick={() => deleteSession(ctxMenu.sid)}>删除</button>
        </div>
      )}

      {/* 移动端抽屉遮罩 */}
      {sidebarOpen && <div className="sidebar-mask" onClick={() => setSidebarOpen(false)} />}

      {/* 消息区 + 输入区 */}
      <main
        className="chat-main"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 移动端顶栏：汉堡按钮打开会话抽屉 */}
        <div className="mobile-bar">
          <button className="hamburger" onClick={() => setSidebarOpen(true)} title="会话列表" aria-label="打开会话列表">
            ☰
          </button>
          <span className="mobile-title">
            {getTitle(currentStoredId)}
          </span>
          <span className={'ws-dot ' + (wsStatus === 'ready' ? 'on' : 'off')} />
        </div>

        <div className="chat-status">
          <span className={'ws-dot ' + (wsStatus === 'ready' ? 'on' : 'off')} />
          {wsStatus === 'ready' ? '已连接' : '连接中…'}
        </div>

        {/* 断线横幅：非 ready 时显示，恢复自动消失 */}
        {wsStatus !== 'ready' && (
          <div className="ws-banner">
            {everReadyRef.current ? '连接已断开，正在重连…' : '正在连接服务器…'}
          </div>
        )}

        <div className="message-list" ref={listRef} onScroll={handleScroll}>
          {loading && <div className="loading">加载中…</div>}
          {!loading && messages.length > 0 && (
            <>
              {/* 顶部 spacer：占位已滚出可视区上方的消息，保持滚动条总高度 */}
              <div className="list-spacer" style={{ height: layout.topPad }} />
              {messages.slice(layout.start, layout.end + 1).map((m, j) => {
                const i = layout.start + j;
                return (
                  <div
                    key={rowKey(m, i)}
                    className="msg-row"
                    ref={(el) => measureRow(el, rowKey(m, i))}
                  >
                    <MessageBubble
                      msg={m}
                      isLast={i === messages.length - 1}
                      streaming={streaming}
                      onImgClick={openLightbox}
                      onCopy={handleCopy}
                      onRegenerate={handleRegenerate}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  </div>
                );
              })}
              {/* 底部 spacer：占位未渲染的可视区下方消息 */}
              <div className="list-spacer" style={{ height: layout.bottomPad }} />
            </>
          )}
          {!loading && !messages.length && <div className="empty">开始和 Hermes 对话吧</div>}
          {error && <div className="error">{error}</div>}
        </div>

        {/* 拖拽上传高亮遮罩 */}
        {dragOver && (
          <div className="drop-overlay">
            <div className="drop-hint">松开上传图片/文件</div>
          </div>
        )}

        {/* 回到底部按钮：未在底部时显示 */}
        {!loading && showScrollBtn && (
          <button className="scroll-bottom" onClick={() => scrollToBottom(true)} title="回到底部">
            ↓
          </button>
        )}

        {/* 待发送预览 */}
        {(images.length > 0 || files.length > 0) && (
          <div className="pending">
            {images.map((p, i) => (
              <span key={'i' + i} className="chip">
                <ChipImageIcon />
                <span className="chip-name" title={p.split('/').pop()}>{p.split('/').pop()}</span>
                <button aria-label="移除图片" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
            {files.map((p, i) => (
              <span key={'f' + i} className="chip">
                <ChipFileIcon />
                <span className="chip-name" title={p.split('/').pop()}>{p.split('/').pop()}</span>
                <button aria-label="移除附件" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        )}

        {/* 排队提示：流式中且队列非空时显示，队列清空自动消失 */}
        {streaming && pendingQueue.length > 0 && (
          <div className="queue-bar">
            <span>回复生成中 · 还有 {pendingQueue.length} 条消息排队</span>
          </div>
        )}

        <div className="composer">
          <input
            ref={imgRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => onPick(e, 'image')}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => onPick(e, 'file')}
          />
          <button className="icon-btn" title="上传图片" onClick={() => imgRef.current && imgRef.current.click()}>
            <ComposerImageIcon />
          </button>
          <button className="icon-btn" title="上传文件" onClick={() => fileRef.current && fileRef.current.click()}>
            <ComposerFileIcon />
          </button>
          <textarea
            ref={inputRef}
            className="input composer-input"
            value={input}
            placeholder={
              streaming
                ? '回复生成中，可继续输入（将排队发送）'
                : '输入消息…（Enter 发送，Shift+Enter 换行）'
            }
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                // 中文输入法（IME）组合期间按 Enter 是选词确认，交给 IME 处理，不发送
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="btn-send"
            onClick={send}
            disabled={!input.trim() && !images.length && !files.length}
          >
            发送
          </button>
          {streaming && (
            <button className="btn-stop" onClick={interrupt} title="中断当前回复">
              <span className="stop-icon">■</span>
              <span className="stop-label">中断</span>
            </button>
          )}
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

      {/* 轻提示 toast（聊天区内独立定位，避免与顶栏改密 toast 重叠） */}
      {toast && <div className="toast chat-toast">{toast}</div>}
    </div>
  );
}
