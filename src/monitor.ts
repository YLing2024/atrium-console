/**
 * 监控页纯函数：时间范围映射、PSI 分级、迷你趋势几何、颜色透明度与磁盘选根。
 *
 * 抽到组件外是为了让阈值与几何逻辑可单测——页面本身只负责取数与排版。
 * 所有函数无 DOM、无请求、无副作用。
 */

/** 主趋势的时间范围标识（也是 Segmented 的取值） */
export type MonitorRange = '1h' | '6h' | '24h' | '7d';

/** 单个时间范围对应的接口参数与刷新节奏 */
export interface MonitorRangeSpec {
  id: MonitorRange;
  label: string;
  /** `/api/admin/system/metrics?range=` 的取值 */
  range: string;
  /** `/api/admin/system/metrics?step=` 的取值 */
  step: string;
  /** 自动刷新间隔（毫秒） */
  refreshMs: number;
}

/** 四个时间范围；步长在保证点位密度的同时避免 7 天拉回上万点。 */
export const MONITOR_RANGES: readonly MonitorRangeSpec[] = [
  { id: '1h', label: '1h', range: '1h', step: '1m', refreshMs: 30_000 },
  { id: '6h', label: '6h', range: '6h', step: '5m', refreshMs: 60_000 },
  { id: '24h', label: '24h', range: '1d', step: '1m', refreshMs: 60_000 },
  { id: '7d', label: '7d', range: '7d', step: '1h', refreshMs: 300_000 }
];

/** 按 id 取范围配置；未知值回退 24h（与默认选中一致）。 */
export function monitorRangeSpec(id: MonitorRange): MonitorRangeSpec {
  return MONITOR_RANGES.find((item) => item.id === id) ?? MONITOR_RANGES[2];
}

/** 语义档位：常态 / 预警 / 危险，颜色由调用方翻译成 antd token。 */
export type ValueTone = 'normal' | 'warning' | 'error';

/** 趋势图可切换的指标标识 */
export type TrendMetric = 'cpu' | 'mem' | 'disk' | 'network' | 'diskio';

/** 一个趋势指标的取列规则：单系列为百分比，双系列为字节/秒。 */
export interface TrendMetricSpec {
  id: TrendMetric;
  label: string;
  /** 历史点里的列名（一或两个） */
  keys: readonly string[];
  /** 图例名称，与 keys 一一对应 */
  series: readonly string[];
  unit: 'percent' | 'rate';
}

/** 趋势指标顺序即 Segmented 顺序；磁盘用后端新增的 disk_percent 列，不伪造历史。 */
export const MONITOR_METRICS: readonly TrendMetricSpec[] = [
  { id: 'cpu', label: 'CPU', keys: ['cpu'], series: ['CPU'], unit: 'percent' },
  { id: 'mem', label: '内存', keys: ['mem_percent'], series: ['内存'], unit: 'percent' },
  { id: 'disk', label: '磁盘', keys: ['disk_percent'], series: ['根分区'], unit: 'percent' },
  { id: 'network', label: '网络', keys: ['net_rx_rate', 'net_tx_rate'], series: ['接收', '发送'], unit: 'rate' },
  {
    id: 'diskio',
    label: '磁盘IO',
    keys: ['disk_io_read', 'disk_io_write'],
    series: ['读', '写'],
    unit: 'rate'
  }
];

/** 按 id 取趋势指标；未知值回退 CPU。 */
export function trendMetricSpec(id: TrendMetric): TrendMetricSpec {
  return MONITOR_METRICS.find((item) => item.id === id) ?? MONITOR_METRICS[0];
}

/**
 * 阈值分级：只有越过预警线才变色，避免常态页面出现状态色。
 * @param value 当前值
 * @param warn 预警阈值（含）
 * @param danger 危险阈值（含）
 */
export function thresholdTone(
  value: number | null | undefined,
  warn: number,
  danger: number
): ValueTone {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'normal';
  if (n >= danger) return 'error';
  if (n >= warn) return 'warning';
  return 'normal';
}

/**
 * PSI 压力分级：<20 主色、20–50 预警、>50 危险（需求书第四节的硬阈值）。
 * @param value `some.avg60`，单位 %
 */
export function pressureTone(value: number | null | undefined): ValueTone {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'normal';
  if (n > 50) return 'error';
  if (n >= 20) return 'warning';
  return 'normal';
}

/** 卡顿指数档位：PSI 等待时间越长，档位越高；与后端 `stall_level` 文案同义。 */
export function stallTone(level: string | null | undefined): ValueTone {
  if (level === '明显卡顿') return 'error';
  if (level === '有压力') return 'warning';
  return 'normal';
}

/** 迷你趋势的几何结果；无有效点时为 null。 */
export interface SparkGeometry {
  /** `<polyline points>` 用的坐标串 */
  line: string;
  /** 折线下方闭合区域的 `<path d>` */
  area: string;
  /** 仅一个有效点时画圆点用 */
  point: { x: number; y: number } | null;
}

/**
 * 把数值序列映射到固定 40×28 的坐标空间。
 *
 * - 不画坐标轴、留 2px 上下边距，尖峰会顶到上边距而不是被裁掉；
 * - 空值被跳过（不同指标采样时刻可能缺列），至少两个点才连线；
 * - 全部值相同时落在垂直中线，不因除零产生 NaN。
 * @param values 原始采样值（可含 null / undefined）
 * @param width 画布宽（默认 40）
 * @param height 画布高（默认 28）
 * @param pad 上下左右留白（默认 2）
 */
export function buildSparkGeometry(
  values: ReadonlyArray<number | null | undefined>,
  width = 40,
  height = 28,
  pad = 2
): SparkGeometry | null {
  const points: Array<{ x: number; y: number }> = [];
  const nums: number[] = [];
  for (const raw of values) {
    if (raw == null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) {
      nums.push(n);
      points.push({ x: 0, y: 0 });
    }
  }
  if (nums.length === 0) return null;

  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max - min < 1e-9) {
    // 完全没波动时（如磁盘占用），画一条平线看起来像一条多余的分隔线；
    // 退回单点，视觉上明确「保持不变」。
    return { point: { x: pad + innerW, y: pad + innerH / 2 }, line: '', area: '' };
  }

  points.forEach((point, i) => {
    point.x = pad + (nums.length === 1 ? innerW / 2 : (i / (nums.length - 1)) * innerW);
    point.y = pad + (1 - (nums[i] - min) / (max - min)) * innerH;
  });

  if (points.length === 1) {
    return { line: '', area: '', point: points[0] };
  }

  const line = points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
  const bottom = height - pad;
  const area =
    `M ${round(points[0].x)},${bottom} ` +
    points.map((p) => `L ${round(p.x)},${round(p.y)}`).join(' ') +
    ` L ${round(points[points.length - 1].x)},${bottom} Z`;
  return { line, area, point: null };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 给 antd token 颜色加透明度：ECharts 的面积渐变需要 rgba，
 * 而 token 可能是 #rgb / #rrggbb / rgb(...) 中的任一形式。
 * @param color antd token 色值
 * @param alpha 0–1
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map((c) => c + c).join('')
      : hex[1];
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${a})`;
  return color;
}

/** 磁盘展示所需的最小字段集合（`DiskInfo` 与 `SystemDiskInfo` 都满足）。 */
export interface DiskLike {
  mount?: string;
  filesystem?: string;
  percent?: number;
  used?: number;
  total?: number;
  free?: number;
}

/**
 * 选「根分区」用于 KPI：优先 `/`，其次第一个挂载点；都没有时回退旧单盘字段。
 * @param disks `/api/admin/system` 的 disks 数组
 * @param fallback 旧后端的单盘 `disk`
 */
export function pickRootDisk(
  disks: ReadonlyArray<DiskLike | null | undefined> | null | undefined,
  fallback?: DiskLike | null
): DiskLike | null {
  const list = Array.isArray(disks) ? disks.filter((d): d is DiskLike => d != null) : [];
  if (list.length) return list.find((d) => d.mount === '/') ?? list[0];
  return fallback ?? null;
}

/**
 * 选使用率最高的挂载点用于磁盘 KPI。使用率缺失的挂载点排在有值之后；
 * 全部缺失时回退到根分区，避免卡片突然空掉。
 * @param disks `/api/admin/system` 的 disks 数组
 * @param fallback 旧后端的单盘 `disk`
 */
export function pickBusiestDisk(
  disks: ReadonlyArray<DiskLike | null | undefined> | null | undefined,
  fallback?: DiskLike | null
): DiskLike | null {
  const list = Array.isArray(disks) ? disks.filter((d): d is DiskLike => d != null) : [];
  if (!list.length) return fallback ?? null;
  let best: DiskLike | null = null;
  for (const disk of list) {
    const value = Number(disk.percent);
    if (!Number.isFinite(value)) continue;
    if (best == null || value > Number(best.percent)) best = disk;
  }
  return best ?? pickRootDisk(list, fallback);
}

/** 磁盘 KPI 下方的一行挂载点摘要。 */
export interface DiskMountSummary {
  mount: string;
  percent: number | null;
}

/**
 * KPI 下方的全部挂载点摘要：`/` 排最前，其余按挂载点字典序。
 * 使用率缺失时 percent 为 null，由渲染层显示破折号而不是 0。
 * @param disks `/api/admin/system` 的 disks 数组
 */
export function diskMountSummaries(
  disks: ReadonlyArray<DiskLike | null | undefined> | null | undefined
): DiskMountSummary[] {
  const list = Array.isArray(disks) ? disks.filter((d): d is DiskLike => d != null) : [];
  return list
    .map((disk) => {
      const n = Number(disk.percent);
      return {
        mount: disk.mount || '—',
        percent: Number.isFinite(n) ? n : null
      };
    })
    .sort((a, b) => {
      if (a.mount === '/') return -1;
      if (b.mount === '/') return 1;
      return a.mount.localeCompare(b.mount);
    });
}

/**
 * 每核迷你条的档位：<70 常态、70–85 预警、≥85 危险。
 * 与磁盘档位分开，避免一个阈值套所有指标。
 * @param value 单核使用率（%）
 */
export function coreTone(value: number | null | undefined): ValueTone {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'normal';
  if (n >= 85) return 'error';
  if (n >= 70) return 'warning';
  return 'normal';
}

/**
 * 负载值展示：兼容数组与后端偶发的字符串。
 * @param loadavg `cpu.loadavg`
 */
export function loadavgText(loadavg: number[] | string | null | undefined): string {
  if (Array.isArray(loadavg)) {
    return loadavg
      .slice(0, 3)
      .map((v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'))
      .join(' / ');
  }
  return loadavg == null || String(loadavg).trim() === '' ? '—' : String(loadavg);
}

/**
 * 主趋势横轴时间：7 天档带日期，其余只到分钟；避免 4–6 个刻度互相挤占。
 * @param ts epoch 毫秒
 * @param range 当前时间范围
 */
export function formatTrendTick(ts: number, range: MonitorRange): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  if (range === '7d') return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 把采样点里某一列取成数字序列：缺列与非法值保留为 null，
 * 让折线断开而不是把缺失当成 0。
 * @param points 趋势点
 * @param key 列名
 */
export function columnValues(
  points: ReadonlyArray<Record<string, number | undefined>>,
  key: string
): Array<number | null> {
  return points.map((point) => {
    const raw = point[key];
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  });
}
