/**
 * 主题：默认跟随系统（prefers-color-scheme），可手动切换浅/深（localStorage key: admin_theme）。
 * 手动选择时给 <html> 设 data-theme 覆盖系统偏好；'auto' 时不设属性，交给 CSS 媒体查询。
 */
const THEME_KEY = 'admin_theme';
const MEDIA = '(prefers-color-scheme: dark)';

/** 实际生效的两档主题 */
export type Theme = 'light' | 'dark';
/** 记忆值：'auto' 表示跟随系统 */
export type ThemePref = Theme | 'auto';

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
  return (localStorage.getItem(THEME_KEY) as ThemePref) || 'auto';
}

// 应用主题到 <html data-theme>，并同步浏览器主题色 meta 与 localStorage
export function applyTheme(theme: ThemePref): void {
  const el = document.documentElement;
  if (theme === 'auto') {
    delete el.dataset.theme;
  } else {
    el.dataset.theme = theme;
  }
  localStorage.setItem(THEME_KEY, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', effectiveTheme(theme) === 'dark' ? '#13110f' : '#f7f6f3');
  }
}

// 启动时调用，避免刷新后闪回
export function initTheme(): void {
  applyTheme(getTheme());
}

// 切换深浅并返回新主题（明确写入，不再回到 auto）
export function toggleTheme(): Theme {
  const next = effectiveTheme(getTheme()) === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
