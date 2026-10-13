/**
 * 主题：三态可选 —— 自动（跟随系统 prefers-color-scheme）/ 亮色 / 暗色。
 * localStorage key: admin_theme，写入 'auto' | 'light' | 'dark'。
 *
 * 手动选择时给 <html> 设 data-theme 覆盖系统偏好；'auto' 时不设属性，交给系统偏好。
 * 颜色本身一律由 antd 默认 token 提供（cssVar 模式下的 --ant-* CSS 变量），
 * 本模块只负责「哪一档主题」与首屏 data-theme / color-scheme 的落定。
 */
const THEME_KEY = 'admin_theme';
const MEDIA = '(prefers-color-scheme: dark)';

/** 实际生效的两档主题 */
export type Theme = 'light' | 'dark';
/** 记忆值：'auto' 表示跟随系统 */
export type ThemePref = Theme | 'auto';

const THEME_PREFS: readonly ThemePref[] = ['auto', 'light', 'dark'];

function isThemePref(value: unknown): value is ThemePref {
  return typeof value === 'string' && (THEME_PREFS as readonly string[]).includes(value);
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(MEDIA).matches
    : false;
}

// 当前生效主题（auto 时解析为系统偏好）
export function effectiveTheme(theme: ThemePref): Theme {
  return theme === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
}

export function getTheme(): ThemePref {
  if (typeof localStorage === 'undefined') return 'auto';
  const raw = localStorage.getItem(THEME_KEY);
  return isThemePref(raw) ? raw : 'auto';
}

// 生效主题变化的订阅口：框架层（antd ConfigProvider）据此同步深浅色。
// 只通知「实际生效」的 light/dark，auto 由系统偏好解析后通知。
type ThemeListener = (theme: Theme) => void;
const listeners = new Set<ThemeListener>();
let systemBound = false;

function notifyTheme(): void {
  const t = effectiveTheme(getTheme());
  listeners.forEach((fn) => fn(t));
}

// 订阅生效主题；订阅时立即回调一次当前值，返回取消订阅函数
export function subscribeTheme(fn: ThemeListener): () => void {
  listeners.add(fn);
  fn(effectiveTheme(getTheme()));
  return () => {
    listeners.delete(fn);
  };
}

// auto 时跟随系统偏好（只绑一次）
function bindSystemTheme(): void {
  if (systemBound || typeof window === 'undefined' || !window.matchMedia) return;
  systemBound = true;
  window.matchMedia(MEDIA).addEventListener('change', () => {
    if (getTheme() === 'auto') notifyTheme();
  });
}

// 同步浏览器 color-scheme meta（供地址栏 / 状态栏等原生 UI 取色；颜色不写死，交给浏览器）。
function syncColorSchemeMeta(dark: boolean): void {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', dark ? 'dark light' : 'light dark');
}

// 应用主题到 <html data-theme>，并同步 color-scheme 与 localStorage
export function applyTheme(theme: ThemePref): void {
  const el = document.documentElement;
  if (theme === 'auto') {
    delete el.dataset.theme;
  } else {
    el.dataset.theme = theme;
  }
  localStorage.setItem(THEME_KEY, theme);
  syncColorSchemeMeta(effectiveTheme(theme) === 'dark');
  notifyTheme();
}

// 显式三态设置：'auto' | 'light' | 'dark'，返回生效主题
export function setThemePref(pref: ThemePref): Theme {
  applyTheme(pref);
  return effectiveTheme(pref);
}

// 启动时调用，避免刷新后闪回
export function initTheme(): void {
  bindSystemTheme();
  applyTheme(getTheme());
}
