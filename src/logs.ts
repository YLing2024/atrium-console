/**
 * 日志页的纯函数与类型：来源标签、级别配色、时间/耗时格式化、详情字段拼装、
 * 滚动触底判定、分页 offset 与剪贴板写入。
 *
 * 网络请求与 UI 状态留在 `pages/Logs.tsx`；这里只放可单测的决策逻辑。
 */

/** 一条日志（`GET /api/admin/logs` 的 entries 项）；详情字段按来源可缺省。 */
export interface LogEntry {
  ts: string;
  source: string;
  name: string;
  level: string;
  message: string;
  host?: string;
  unit?: string;
  container?: string;
  file_path?: string;
  process?: string;
  pid?: string;
  method?: string;
  path?: string;
  status?: string;
  duration?: string;
  client_ip?: string;
}

/** 日志检索响应；分页字段用于计算下一次 offset。 */
export interface LogResult {
  entries: LogEntry[];
  hasMore: boolean;
  source: string;
  limit: number;
  offset: number;
}

/** 来源 → 展示名；未知来源原样显示，避免吞掉后端新增来源。 */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'system':
      return '系统 journald';
    case 'container':
      return '容器';
    case 'file':
      return '业务文件';
    case 'access':
      return 'Nginx access';
    case 'error':
      return 'Nginx error';
    default:
      return source || '—';
  }
}

/** 级别 → Tag 颜色，未识别的不上色。 */
export function levelColor(level: string): string {
  switch (level) {
    case 'error':
      return 'error';
    case 'warn':
      return 'warning';
    case 'notice':
      return 'blue';
    case 'debug':
      return 'default';
    default:
      return 'default';
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * 时间字符串 → 本地「YYYY-MM-DD HH:mm:ss.SSS」。
 * 后端给 RFC3339（UTC），这里按浏览器本地时区展示并保留毫秒；解析失败原样返回。
 */
export function formatLogTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 耗时（秒）补单位；空值返回空串，交给字段表过滤。 */
export function formatLogDuration(value: string | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  const n = Number(raw);
  return Number.isFinite(n) ? `${raw} s` : raw;
}

/** 详情字段表的候选顺序：值与标签一一对应，空值由调用方过滤。 */
export function buildLogDetailFields(entry: LogEntry): { label: string; value: string }[] {
  const candidates: { label: string; value: string }[] = [
    { label: '主机', value: entry.host || '' },
    { label: '单元', value: entry.unit || '' },
    { label: '容器', value: entry.container || '' },
    { label: '文件路径', value: entry.file_path || '' },
    { label: '进程', value: entry.process || '' },
    { label: 'PID', value: entry.pid || '' },
    { label: '请求方法', value: entry.method || '' },
    { label: '路径', value: entry.path || '' },
    { label: '状态码', value: entry.status || '' },
    { label: '耗时', value: formatLogDuration(entry.duration) },
    { label: '客户端 IP', value: entry.client_ip || '' }
  ];
  return candidates.filter((item) => item.value.trim() !== '');
}

/** 滚动触底判定：加载中、失败后、没有下一页都不再自动触发。 */
export function shouldAutoLoad(
  metrics: {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
    loading: boolean;
    hasMore: boolean;
    failed: boolean;
  },
  threshold = 80
): boolean {
  if (!metrics.hasMore || metrics.loading || metrics.failed) return false;
  return metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - threshold;
}

/** 下一次请求的 offset：按服务端实际 limit 前进，避免返回条数被截断时重复整页。 */
export function nextLogOffset(result: Pick<LogResult, 'offset' | 'limit'>, fallbackLimit: number): number {
  const limit = Number.isFinite(result.limit) && result.limit > 0 ? result.limit : fallbackLimit;
  const offset = Number.isFinite(result.offset) && result.offset >= 0 ? result.offset : 0;
  return offset + limit;
}

/** 复制为 JSON：只序列化这条日志本身，缩进两格便于粘贴阅读。 */
export function logJson(entry: LogEntry): string {
  return JSON.stringify(entry, null, 2);
}

/**
 * 写入剪贴板：优先异步 Clipboard API，权限/环境不支持时降级到隐藏 textarea +
 * `document.execCommand('copy')`；两种方式都失败返回 false，由 UI 提示手动选择。
 */
export async function copyLogText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒或非安全上下文：继续走 execCommand 降级
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
