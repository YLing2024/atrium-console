/**
 * 极简前端路由（原生 History API，零依赖）。
 *
 * 后台是单页应用，路径与内容一一对应：
 * `/system` `/sites` `/blog` `/manage` `/ssh` `/terminal` `/hermes` `/database` `/tools`
 * 以及工具子页 `/tools/<tool>`（当前只有 `bitwarden`）。`/` 与未知路径都用
 * `replaceState` 归一到 `/system`，不产生多余的历史记录。
 *
 * 为什么不用 react-router：这里只需要「路径 → section/tool」一层解析，
 * 侧栏与命令面板也只需要 `navigate()`，引一个路由库反而多一层状态。
 *
 * 约定：`navigate()` 只改地址栏并广播，不直接改 React 状态；组件统一通过
 * `subscribe()` 重新 `readRoute()`，因此浏览器前进 / 后退（`popstate`）与
 * 主动跳转走同一条更新路径。
 */

const ROUTE_EVENT = 'admin:routechange';

/** 允许出现在 `/metrics/<key>` 里的指标 id（与趋势四图一致）。 */
const METRIC_KEYS = new Set(['cpu', 'mem', 'disk', 'net']);

/** 路由解析结果：`section` 与侧栏 Tab id 保持一致；`tool` 仅工具子页有值。 */
export interface Route {
  section: string;
  tool?: string;
  /** 指标下钻页 `/metrics/<key>` 的指标名 */
  metric?: string;
}

/** section（侧栏 Tab id）→ 规范路径。id 保持不变，仅在 URL 上使用更短的别名。 */
const SECTION_PATHS: Record<string, string> = {
  system: '/system',
  sites: '/sites',
  blog: '/blog',
  manage: '/manage',
  sshkeys: '/ssh',
  terminal: '/terminal',
  hermes: '/hermes',
  db: '/database',
  tools: '/tools',
  logs: '/logs',
  metrics: '/metrics',
};

/** URL 路径段 → section；`/sshkeys`、`/db` 作为历史别名也接受，随后归一到规范路径。 */
const SEGMENT_SECTIONS: Record<string, string> = {
  system: 'system',
  sites: 'sites',
  blog: 'blog',
  manage: 'manage',
  ssh: 'sshkeys',
  sshkeys: 'sshkeys',
  terminal: 'terminal',
  hermes: 'hermes',
  database: 'db',
  db: 'db',
  tools: 'tools',
  logs: 'logs',
  metrics: 'metrics',
};

/** 允许出现在 `/tools/<tool>` 里的工具 id。 */
const TOOL_IDS = new Set(['bitwarden']);

/**
 * 解析路径（纯函数，便于单测）。返回 `null` 表示未知路径或层级不符，
 * 由调用方决定如何重定向。
 */
export function parseRoute(pathname: string): Route | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const section = SEGMENT_SECTIONS[segments[0]];
  if (!section) return null;

  // 指标下钻页：/metrics/<cpu|mem|disk|net>
  if (section === 'metrics') {
    if (segments.length === 1) return { section };
    if (segments.length === 2 && METRIC_KEYS.has(segments[1])) {
      return { section, metric: segments[1] };
    }
    return null;
  }

  if (section !== 'tools') {
    return segments.length === 1 ? { section } : null;
  }
  if (segments.length === 1) return { section };
  if (segments.length === 2 && TOOL_IDS.has(segments[1])) {
    return { section, tool: segments[1] };
  }
  return null;
}

/** section / 工具 id → 规范路径；未知 section 回落到系统页。 */
export function routePath(section: string, tool?: string, metric?: string): string {
  if (section === 'metrics' && metric && METRIC_KEYS.has(metric)) return `/metrics/${metric}`;
  if (section === 'tools' && tool && TOOL_IDS.has(tool)) return `/tools/${tool}`;
  return SECTION_PATHS[section] ?? '/system';
}

function replaceWith(path: string): void {
  window.history.replaceState(null, '', path + window.location.search + window.location.hash);
}

/** 读取当前地址对应的路由；未知路径立即归一到 `/system`（不写历史）。 */
export function readRoute(): Route {
  const route = parseRoute(window.location.pathname);
  if (!route) {
    replaceWith('/system');
    return { section: 'system' };
  }

  // 别名（/sshkeys、/db）与多余斜杠统一成规范路径，避免同一内容出现多个可收藏地址。
  const canonical = routePath(route.section, route.tool, route.metric);
  if (window.location.pathname !== canonical) replaceWith(canonical);

  return route;
}

/**
 * 跳转到指定路径：`pushState` 后广播一次路由变化。
 * 与当前地址完全相同（忽略 hash）时直接返回，避免侧栏重复点击堆历史记录。
 */
export function navigate(path: string): void {
  const url = new URL(path, window.location.origin);
  if (url.pathname === window.location.pathname && url.search === window.location.search) return;

  window.history.pushState(null, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

/** 订阅路由变化（主动 `navigate` 与浏览器 `popstate`）；返回取消订阅函数。 */
export function subscribe(fn: () => void): () => void {
  window.addEventListener(ROUTE_EVENT, fn);
  window.addEventListener('popstate', fn);
  return () => {
    window.removeEventListener(ROUTE_EVENT, fn);
    window.removeEventListener('popstate', fn);
  };
}
