// 纯格式化 / 数值辅助函数（无 DOM、无副作用），从组件逐字搬移而来以便单测。
// 行为与搬移前完全一致：仅去掉组件内的局部定义、加 export 并在组件处 import。

// 字节数 → 人类可读（1024 进制，1 位小数）
export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(1) + ' ' + units[i];
}

// 兆字节展示：整数不带小数，小数保留 1 位
export function fmtMB(mb: number | null | undefined): string {
  if (mb == null || !Number.isFinite(Number(mb))) return '—';
  const v = Number(mb);
  return (Number.isInteger(v) ? v : v.toFixed(1)) + ' MB';
}

// 速率（B/s）
export function fmtRate(bps: number | null | undefined): string {
  if (bps == null || !isFinite(bps)) return '—';
  return fmtBytes(bps) + '/s';
}

// 秒数 → 「N 天 N 小时 N 分钟」；不足一分钟显示「刚刚」
export function fmtDuration(s: number | string | null | undefined): string {
  if (s == null || !Number.isFinite(Number(s))) return '—';
  s = Math.floor(Number(s));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(d + ' 天');
  if (h) parts.push(h + ' 小时');
  if (m) parts.push(m + ' 分钟');
  return parts.join(' ') || '刚刚';
}

// 占用率 → 颜色分级：>80% 红、60-80% 橙、<60% 绿（Bar 与每核小条共用）
export function toneFor(percent: number | null | undefined): string {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return p > 80 ? 'hi' : p >= 60 ? 'mid' : 'low';
}

// 百分比小数的展示：有限数保留一位小数，null/非法显示 —
export function fmtPct(v: number | string | null | undefined): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}

// 向上取整到友好刻度（1/2/5×10^n），用于速率类 Y 轴
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}

// 平移位置钳制到 [0, len - win]
export function clampOffset(o: number, len: number, win: number): number {
  return Math.min(Math.max(0, o), Math.max(0, len - win));
}

// 文件大小展示（1024 进制；≥100 时不留小数）
export function fmtSize(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

// 文件名扩展名（大写，最多 5 位）；无扩展名返回空串
export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toUpperCase().slice(0, 5);
}
