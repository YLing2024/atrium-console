/**
 * System —— 「系统」Tab 面板：实时系统指标（SSE）、磁盘/网络趋势图与全量进程树。
 *
 * 数据来源：
 * - 系统指标 / 服务状态 / 秒级 history 走 SSE `/api/admin/system/stream`（Tab 激活时才建连）；
 * - 进程全量树走 REST `/api/admin/services`，仅 Tab 激活时每 5s 取样（SSE 帧不再携带进程明细）；
 * - 非秒档趋势走 `/api/admin/system/metrics` 聚合接口。
 *
 * 进程树的三处口径（与后端 docs/API.md 一致）：
 * - 内存拆两列：「内存（含子进程）」= `subtree_mem_mb`，「自身」= `mem_mb`，两者各自可排；
 * - `subtree_count` 由服务端算好，前端不再自己数；
 * - 合计行并列 `total_mem_mb`（全部 RSS，含共享页重复计算）与 `total_cgroup_mb`（cgroup 真值），
 *   进程数与线程数为两个口径，并列显示、不得混算。
 *
 * 「含线程」开关默认关闭；开启后在进程名后显示该进程 `thread_count`（读不到为 null 时不显示）。
 *
 * 展开行为：拿到第一份进程数据后一次性受控展开全部；此后 5s 轮询刷新不得强制重新展开，
 * 用户手动折叠的选择保留。
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Key,
  type ReactNode
} from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Progress,
  Row,
  Segmented,
  Space,
  Spin,
  Switch,
  Table,
  Typography,
  theme
} from 'antd';
import type { TableColumnsType } from 'antd';
import type { EChartsType } from 'echarts/core';
import type { LineSeriesOption } from 'echarts/charts';
import { getServices, getSystemMetrics } from '../api';
import type { CoreUsage, DiskInfo, HistoryPoint, ProcessInfo, PsiInfo, ServiceInfo, SystemData } from '../api';
import { clampOffset, fmtBytes, fmtDuration, fmtMB, fmtPct, fmtRate, toneFor } from '../format';
import { buildProcTree, collectProcPids, sortProcTree, type ProcSortKey, type ProcTreeNode } from '../procTree';
import type { EChartsOption } from './Chart';

// ECharts 体积大：图表实现（Chart.tsx + echarts）改为动态 import，
// 只在系统面板真正要画趋势图时才拉取，主入口与其它面板都不引入。
const Chart = lazy(() => import('./Chart'));

/** 系统 SSE snapshot 帧结构（进程明细已不从 SSE 读，见下方 REST 取样） */
interface SystemSnapshot {
  system?: SystemData;
  history?: HistoryPoint[];
  services?: {
    services?: ServiceInfo[];
    total_cpu?: number;
  };
}

/** 序列语义色：只给 antd 主题 token 的用途名，颜色在组件内按 token 解析 */
type SeriesTone = 'primary' | 'secondary' | 'success' | 'error';

/** 趋势图序列定义（颜色由 SeriesTone 解析，不写死色值） */
interface SeriesSpec {
  key: string;
  label: string;
  tone: SeriesTone;
  format?: (v: number | null | undefined) => string;
}

/** 已解析出具体颜色的序列（传给 Legend / Chart） */
interface ChartSeries {
  key: string;
  label: string;
  color: string;
  format?: (v: number | null | undefined) => string;
}

function fmtTime(ts: number): string {
  const t = new Date(ts);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// 占用率 → 进度条颜色（分级规则见 toneFor，颜色取自 antd 主题 token）
function clampPct(p?: number | null): number {
  return Math.max(0, Math.min(100, Number(p) || 0));
}

/**
 * 进度条：CPU / 内存 / 磁盘卡片共用。
 * @param percent 百分比（0–100，越界自动钳制；`null`/`undefined` 视为 0）
 * @param color 条色，由调用方按 antd token 给出（如 barColor 的分级结果）
 */
function Bar({ percent, color }: { percent?: number | null; color: string }) {
  return <Progress percent={clampPct(percent)} showInfo={false} strokeColor={color} />;
}

/**
 * 每核占用区块。
 * @param cores `cpu.per_core`；缺失或为空数组时整块不渲染（兼容旧后端）
 * @param colorOf 百分比 → 条色（颜色分级规则由调用方给出）
 */
function CoreGrid({ cores, colorOf }: { cores?: CoreUsage[]; colorOf: (p: number) => string }) {
  if (!Array.isArray(cores) || cores.length === 0) return null;
  return (
    <Row gutter={[12, 10]} style={{ marginBottom: 8 }}>
      {cores.map((c, i) => {
        const id = c && c.id != null ? c.id : i;
        const raw = c && c.usage_percent != null ? Number(c.usage_percent) : 0;
        const p = clampPct(Number.isFinite(raw) ? raw : 0);
        return (
          <Col key={id} xs={12} sm={8} md={6}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <Typography.Text type="secondary">#{id}</Typography.Text>
              <Typography.Text>{p.toFixed(1)}%</Typography.Text>
            </div>
            <Progress percent={p} showInfo={false} strokeColor={colorOf(p)} size="small" />
          </Col>
        );
      })}
    </Row>
  );
}

/**
 * 单块磁盘卡片：多盘列表与旧单盘回退共用同一结构。
 * @param title 卡片标题（如「磁盘 /」）
 * @param disk 磁盘占用信息（`DiskInfo`）
 * @param colorOf 百分比 → 条色
 */
function DiskCard({
  title,
  disk,
  colorOf
}: {
  title: string;
  disk: DiskInfo;
  colorOf: (p: number) => string;
}) {
  return (
    <Card title={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <Typography.Text>已用 {fmtBytes(disk.used)}</Typography.Text>
        <Typography.Text type="secondary">
          {disk.percent == null ? '—' : disk.percent + '%'} · 共 {fmtBytes(disk.total)}
        </Typography.Text>
      </div>
      <Bar percent={disk.percent} color={colorOf(clampPct(disk.percent))} />
      <InfoRow k="剩余 / 总" v={`${fmtBytes(disk.free)} / ${fmtBytes(disk.total)}`} />
    </Card>
  );
}

/**
 * 键值详情行（左键右值，值可溢出换行）。
 * @param k 键（ReactNode）
 * @param v 值（ReactNode）
 * @param valueStyle 值的附加样式（如 PSI 压力的警示色）
 */
function InfoRow({ k, v, valueStyle }: { k: ReactNode; v: ReactNode; valueStyle?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}>
      <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
        {k}
      </Typography.Text>
      <Typography.Text style={{ textAlign: 'right', overflowWrap: 'anywhere', ...valueStyle }}>
        {v}
      </Typography.Text>
    </div>
  );
}

/**
 * PSI 压力行：显示 some/full 的 avg10，压力越大颜色越警示。
 * @param k 资源名（内存 / CPU / I/O）
 * @param o `/proc/pressure` 解析结果；无 PSI 时显示「—」
 * @param danger some≥50 时使用的警示色
 * @param warn some≥30 时使用的警示色
 */
function PsiRow({
  k,
  o,
  danger,
  warn
}: {
  k: string;
  o?: PsiInfo | null;
  danger: string;
  warn: string;
}) {
  if (!o || !o.some) return <InfoRow k={k} v="—" />;
  const s = Number(o.some.avg10);
  const color = s >= 50 ? danger : s >= 30 ? warn : undefined;
  const v = `some ${fmtPct(o.some.avg10)}% · full ${fmtPct(o.full ? o.full.avg10 : null)}%`;
  return <InfoRow k={k} v={v} valueStyle={color ? { color } : undefined} />;
}

// 秒档默认窗口（30 个点，行为保持不变）；分钟/小时/天档默认最近约 60 个点
const WINDOW = 30;
const WINDOW_WIDE = 60;

// 各档位 / 各图表的平移位置记忆（内存即可）：切走再切回时恢复上次位置，不回弹
const chartViewMemory = new Map<string, { offset: number; follow: boolean }>();

// X 轴时间刻度格式化：分钟 HH:mm、小时 MM-DD HH:00、天 MM-DD、秒 HH:mm:ss（秒档不变）
function formatTick(ts: number, granularity: string): string {
  const t = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  if (granularity === 'hour') return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:00`;
  if (granularity === 'day') return `${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  if (granularity === 'min') return `${p(t.getHours())}:${p(t.getMinutes())}`;
  return fmtTime(ts); // 秒档 HH:mm:ss（沿用原函数，行为不变）
}

/**
 * 趋势图：ECharts 折线，多序列共用一个 Y 轴。
 * - 秒档（granularity='sec'）行为保持原样：窗口 30 点、跟随最新、可平移、回最新按钮。
 * - 分钟/小时/天档（sparse=true）：窗口 60 点；平移位置按档位记忆在内存。
 * - 平移统一走 ECharts dataZoom(type:'inside')，触屏 / 滚轮 / 拖动均可。
 * @param data 采样点（`HistoryPoint[]`）；空或秒档不足 2 点时显示占位文案
 * @param series 已解析出颜色的序列定义
 * @param yMax 固定 Y 轴上界（百分比图用 100）；未给时按数据自适应
 * @param yLabel Y 轴单位后缀（如 '%'）
 * @param granularity 档位：sec/min/hour/day
 * @param chartId 图表标识（与 granularity 组成平移位置记忆键）
 * @param recordedMinutes 非秒档占位文案用的已记录分钟数
 */
function TrendChart({
  data,
  series,
  yMax,
  yLabel,
  granularity,
  chartId,
  recordedMinutes
}: {
  data: HistoryPoint[];
  series: ChartSeries[];
  yMax?: number;
  yLabel?: string;
  granularity: string;
  chartId: string;
  recordedMinutes?: number | null;
}) {
  const { token } = theme.useToken();
  const sparse = granularity !== 'sec';
  const win = sparse ? WINDOW_WIDE : WINDOW;
  const memoryKey = sparse && chartId ? granularity + ':' + chartId : null;

  const remembered = memoryKey ? chartViewMemory.get(memoryKey) : null;
  const [offset, setOffset] = useState(remembered ? remembered.offset : 0);
  const followRef = useRef(remembered ? remembered.follow : true);
  const memKeyRef = useRef<string | null>(memoryKey);
  const rangeRef = useRef({ len: data ? data.length : 0, win });
  memKeyRef.current = memoryKey;
  rangeRef.current = { len: data ? data.length : 0, win };

  // 记住当前平移位置（仅非秒档；秒档 memoryKey=null，行为不变）
  const remember = useCallback((nextOffset: number, following: boolean) => {
    followRef.current = following;
    const key = memKeyRef.current;
    if (key) chartViewMemory.set(key, { offset: nextOffset, follow: following });
  }, []);

  // dataZoom 平移回调：同步跟随状态与位置（回最新按钮据此显隐）
  const onReady = useCallback(
    (chart: EChartsType) => {
      chart.on('datazoom', (params: unknown) => {
        const p = params as { batch?: Array<Record<string, number>> };
        const b = p.batch && p.batch[0];
        if (!b) return;
        const { len: L, win: W } = rangeRef.current;
        let start = b.startValue;
        let end = b.endValue;
        if (start == null && b.start != null) start = Math.round((b.start / 100) * (L - 1));
        if (end == null && b.end != null) end = Math.round((b.end / 100) * (L - 1));
        const s = Math.round(start == null ? 0 : start);
        const e = Math.round(end == null ? L - 1 : end);
        const following = e >= L - 1;
        const next = Math.max(0, Math.min(s, Math.max(0, L - W)));
        remember(next, following);
        setOffset((cur) => (cur !== next ? next : cur));
      });
    },
    [remember]
  );

  // 切换档位（memoryKey 变化）：先恢复该档位上次的平移位置（须在下面的数据 effect 之前执行）
  useEffect(() => {
    if (!memoryKey) return;
    const m = chartViewMemory.get(memoryKey);
    followRef.current = m ? m.follow : true;
    setOffset(m ? m.offset : 0);
  }, [memoryKey]);

  // 数据更新时自动跟随：初始及跟随状态下始终对齐最新；
  // 用户手动平移离开最新后保持当前位置不跳动
  useEffect(() => {
    if (!data) return;
    if (followRef.current) {
      const next = Math.max(0, data.length - win);
      setOffset((cur) => (cur !== next ? next : cur));
      if (memoryKey) chartViewMemory.set(memoryKey, { offset: next, follow: true });
    } else {
      // 非跟随：仅在越界时 clamp，避免保留非法 offset，绝不回弹到最新
      setOffset((cur) => {
        const next = clampOffset(cur, data.length, win);
        if (memoryKey) chartViewMemory.set(memoryKey, { offset: next, follow: false });
        return next;
      });
    }
  }, [data, win, memoryKey]);

  const isEmpty = !data || data.length === 0;
  // 秒档不足 2 点：行为保持原样（占位）；非秒档单点也要可见
  const tooFew = !sparse && !isEmpty && data.length < 2;

  if (isEmpty || tooFew) {
    const text = sparse
      ? `数据积累中（已记录 ${recordedMinutes == null ? 0 : recordedMinutes} 分钟）`
      : '数据采集中…（约 3 秒后显示趋势）';
    return (
      <div style={{ padding: '32px 0', textAlign: 'center' }}>
        <Typography.Text type="secondary">{text}</Typography.Text>
      </div>
    );
  }

  const len = data.length;
  const maxOffset = Math.max(0, len - win);
  const isFollowing = offset + win >= len;

  const option: EChartsOption = {
    animation: false,
    grid: { left: 56, right: 16, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis' },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: data.map((d) => formatTick(d.ts, granularity)),
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: token.colorBorderSecondary } },
      axisLabel: { color: token.colorTextTertiary, hideOverlap: true }
    },
    yAxis: yMax
      ? {
          type: 'value',
          min: 0,
          max: yMax,
          splitNumber: 2,
          axisLabel: {
            color: token.colorTextTertiary,
            formatter: (v: number) => Math.round(v) + (yLabel || '%')
          },
          splitLine: { lineStyle: { color: token.colorBorderSecondary } }
        }
      : {
          type: 'value',
          min: 0,
          axisLabel: {
            color: token.colorTextTertiary,
            formatter: (v: number) => fmtRate(v)
          },
          splitLine: { lineStyle: { color: token.colorBorderSecondary } }
        },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        startValue: offset,
        endValue: offset + win - 1,
        zoomOnMouseWheel: false,
        moveOnMouseWheel: true,
        moveOnMouseMove: true,
        filterMode: 'filter',
        preventDefaultMouseMove: false
      }
    ],
    series: series.map<LineSeriesOption>((s) => ({
      name: s.label,
      type: 'line',
      showSymbol: len <= 1,
      symbolSize: 4,
      lineStyle: { width: 1.5, color: s.color },
      itemStyle: { color: s.color },
      data: data.map((d) => {
        const v = Number(d[s.key]);
        return Number.isFinite(v) ? v : null;
      })
    }))
  };

  return (
    <div style={{ position: 'relative' }}>
      {!isFollowing && (
        <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 2 }}>
          <Button
            size="small"
            onClick={() => {
              remember(maxOffset, true);
              setOffset(maxOffset);
            }}
          >
            回最新
          </Button>
        </div>
      )}
      <Suspense
        fallback={
          <div
            style={{
              height: 220,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Spin />
          </div>
        }
      >
        <Chart option={option} height={220} onReady={onReady} />
      </Suspense>
    </div>
  );
}

/**
 * 趋势图例：色块 + 名称 + 最新值。
 * @param series 已解析出颜色的序列定义
 * @param data 采样点；取最后一个点的各序列值展示
 */
function Legend({ series, data }: { series: ChartSeries[]; data: HistoryPoint[] }) {
  const last = data && data.length ? data[data.length - 1] : null;
  return (
    <Space size={16} wrap style={{ marginBottom: 8 }}>
      {series.map((s) => (
        <Space key={s.key} size={6}>
          <Badge color={s.color} />
          <Typography.Text>{s.label}</Typography.Text>
          {last != null && (
            <Typography.Text type="secondary">
              {s.format ? s.format(last[s.key]) : last[s.key]}
            </Typography.Text>
          )}
        </Space>
      ))}
    </Space>
  );
}

// 趋势序列定义：语义色 → antd 主题 token（主色 / 中性 / 成功 / 错误），深浅色自动适配
const MEM_SPECS: SeriesSpec[] = [
  { key: 'cpu', label: 'CPU', tone: 'secondary' },
  { key: 'mem_percent', label: '物理内存', tone: 'primary' },
  { key: 'swap_percent', label: 'Swap', tone: 'success' }
];
const PSI_SPECS: SeriesSpec[] = [
  { key: 'psi_mem_avg10', label: '内存', tone: 'error', format: fmtPct },
  { key: 'psi_cpu_avg10', label: 'CPU', tone: 'primary', format: fmtPct },
  { key: 'psi_io_avg10', label: 'I/O', tone: 'secondary', format: fmtPct }
];
const NET_SPECS: SeriesSpec[] = [
  { key: 'net_rx_rate', label: '↓ 下载', tone: 'primary', format: fmtRate },
  { key: 'net_tx_rate', label: '↑ 上传', tone: 'secondary', format: fmtRate }
];
const IO_SPECS: SeriesSpec[] = [
  { key: 'disk_io_read', label: '读', tone: 'primary', format: fmtRate },
  { key: 'disk_io_write', label: '写', tone: 'secondary', format: fmtRate }
];

// 趋势粒度：秒 = 现有 SSE 实时流（默认，行为不变）；其它档位改用历史聚合接口。
// 选择存 sessionStorage，刷新后保持；首次访问默认「秒」。
const GRANULARITY_KEY = 'admin_trend_granularity';
const GRANULARITY_OPTIONS = [
  { id: 'sec', label: '秒' },
  { id: 'min', label: '分钟' },
  { id: 'hour', label: '小时' },
  { id: 'day', label: '天' }
];
const GRANULARITY_IDS = GRANULARITY_OPTIONS.map((g) => g.id);
// 非秒档位的 range/step 与刷新频率（与需求表一致）
const GRANULARITY_QUERY: Record<string, { range: string; step: string; refreshMs: number }> = {
  min: { range: '1d', step: '1m', refreshMs: 30000 },
  hour: { range: '7d', step: '1h', refreshMs: 300000 },
  day: { range: '30d', step: '1d', refreshMs: 1800000 }
};

// 读取上次选择：非法值（含旧版本残留）一律回退「秒」
function readGranularity(): string {
  try {
    const v = sessionStorage.getItem(GRANULARITY_KEY);
    if (v && GRANULARITY_IDS.includes(v)) return v;
  } catch (e) {
    // sessionStorage 不可用：走默认
  }
  return 'sec';
}

/**
 * 「系统」Tab 面板组件。
 * @param active 该 Tab 是否激活：为 true 时才建 SSE 连接并按 5s 取样进程树；切走即断开、零残留。
 *   注意：面板在 Main 里常驻挂载（仅切换显隐），故 active 由父级显式传入、不用挂载/卸载控制取数。
 */
export default function System({ active }: { active: boolean }) {
  const [data, setData] = useState<SystemData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  // 合计行用：count（截断前进程总数）与 total_mem_mb（全部进程 RSS 之和），均来自 REST /services
  const [procTotalCount, setProcTotalCount] = useState<number | null>(null);
  const [procTotalMemMb, setProcTotalMemMb] = useState<number | null>(null);
  const [totalCpu, setTotalCpu] = useState<number | null>(null);
  // 进程总量口径（来自 REST /services）：截断标记、解析失败行数、cgroup 真值、线程总数，供合计行与提示
  const [procTruncated, setProcTruncated] = useState(false);
  const [procSkippedCount, setProcSkippedCount] = useState(0);
  const [procTotalCgroupMb, setProcTotalCgroupMb] = useState<number | null>(null);
  const [procTotalThreads, setProcTotalThreads] = useState<number | null>(null);
  // 「含线程」开关：默认关闭；开启后在进程名后显示各进程线程数（不改动其它列/合计口径）
  const [showThreads, setShowThreads] = useState(false);
  // 受控展开：拿到第一份进程数据后一次性展开全部；此后保留用户手动折叠的选择
  const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>([]);
  const autoExpandedRef = useRef(false);
  const [procSort, setProcSort] = useState('mem');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<Date | null>(null);
  const [granularity, setGranularity] = useState(readGranularity);
  const [trendPoints, setTrendPoints] = useState<HistoryPoint[]>([]);
  // 非秒档最近一次成功响应里的 meta（用于「数据积累中（已记录 X 分钟）」占位）
  const [trendRecordedMinutes, setTrendRecordedMinutes] = useState<number | null>(null);
  const trendCacheRef = useRef<Record<string, HistoryPoint[]>>({}); // 各档位上次成功的数据，切回时立即命中，避免闪空
  const trendMetaCacheRef = useRef<Record<string, { recordedSeconds?: number }>>({}); // 各档位上次成功的 meta

  // 系统指标走 SSE；进程全量列表在系统 Tab 激活时每 5s 取样一次。
  // 用 fetch + ReadableStream 自管流（非 EventSource）：需要在客户端做连接状态与重连观测；
  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;

    // 解析单条 SSE 帧（event: / data: 行），data 为 JSON { system, services, history }
    function parseFrame(frame: string) {
      let event: string | null = null;
      let data: string | null = null;
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data = line.slice(5).trim();
      }
      if (event !== 'snapshot' || data == null) return;
      let d: SystemSnapshot;
      try {
        d = JSON.parse(data) as SystemSnapshot;
      } catch (e) {
        return;
      }
      if (!d || d.system == null) return;
      setData(d.system);
      setHistory(Array.isArray(d.history) ? d.history : []);
      const s = d.services || {};
      setServices(Array.isArray(s) ? s : s.services || []);
      setTotalCpu(s.total_cpu != null ? s.total_cpu : null);
      setUpdated(new Date());
      setError('');
    }

    async function connect() {
      if (disposed) return;
      ctrl = new AbortController();
      try {
        const resp = await fetch('/api/admin/system/stream', {
          signal: ctrl.signal
        });
        if (!resp.ok || !resp.body) throw new Error('SSE HTTP ' + resp.status);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!disposed && !ctrl.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (frame) parseFrame(frame);
          }
        }
      } catch (e) {
        if (disposed || ctrl.signal.aborted) return; // 主动断开：静默退出
      }
      if (disposed || ctrl.signal.aborted) return;
      // 连接断开（或流结束）且 Tab 仍激活：提示并 5s 后自动重试
      setError('连接已断开，正在重连…');
      retryTimer = setTimeout(connect, 5000);
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ctrl?.abort(); // 切走 / 卸载立即断开，零残留
    };
  }, [active]);

  // 进程全量列表：SSE 帧已不再携带进程明细，改从 REST /api/admin/services 取样。
  // 仅系统 Tab 激活时生效：激活立即拉一次，此后每 5s 一次；切走 / 卸载立即 abort + 清定时器。
  // 拉取失败保留上次列表（不清空），不弹新提示，等待下个周期重试。
  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let ctrl: AbortController | null = null;

    async function load() {
      ctrl?.abort(); // 上一条未完成即作废，避免慢响应覆盖新数据
      ctrl = new AbortController();
      try {
        const d = await getServices({ signal: ctrl.signal });
        if (disposed) return;
        if (Array.isArray(d.processes)) setProcesses(d.processes);
        if (d.count != null) setProcTotalCount(Number(d.count));
        if (d.total_mem_mb != null) setProcTotalMemMb(Number(d.total_mem_mb));
        setProcTruncated(d.truncated === true);
        setProcSkippedCount(d.skipped_count != null ? Number(d.skipped_count) : 0);
        setProcTotalCgroupMb(d.total_cgroup_mb != null ? Number(d.total_cgroup_mb) : null);
        setProcTotalThreads(d.total_threads != null ? Number(d.total_threads) : null);
      } catch (e) {
        // 拉取失败 / 主动中止：保留上次数据
      }
    }

    load();
    timer = setInterval(load, 5000);

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      ctrl?.abort(); // 切走 / 卸载立即停止取样，零残留
    };
  }, [active]);

  // 非「秒」档位：忽略 SSE 数据对趋势图的影响，改从历史聚合接口按刷新频率拉取。
  // 切换档位立即拉一次；失败保持上一帧（不清空），不闪空、不影响页面其它部分。
  useEffect(() => {
    const cfg = GRANULARITY_QUERY[granularity];
    if (!active || !cfg) return;

    let disposed = false;
    let timer = null;

    // 该档位已有缓存：先立即渲染，避免切回时闪空
    const cached = trendCacheRef.current[granularity];
    if (Array.isArray(cached)) setTrendPoints(cached);
    const cachedMeta = trendMetaCacheRef.current[granularity];
    if (cachedMeta && Number.isFinite(Number(cachedMeta.recordedSeconds))) {
      setTrendRecordedMinutes(Math.floor(Number(cachedMeta.recordedSeconds) / 60));
    }

    async function load() {
      try {
        const d = await getSystemMetrics(cfg.range, cfg.step);
        if (disposed) return;
        if (d && Array.isArray(d.points)) {
          trendCacheRef.current[granularity] = d.points;
          setTrendPoints(d.points);
          if (d.meta && Number.isFinite(Number(d.meta.recordedSeconds))) {
            trendMetaCacheRef.current[granularity] = d.meta;
            setTrendRecordedMinutes(Math.floor(Number(d.meta.recordedSeconds) / 60));
          }
        }
      } catch (e) {
        // 请求失败：保留上一帧，等待下次刷新重试
      }
    }

    load();
    timer = setInterval(load, cfg.refreshMs);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [granularity, active]);

  // 切换粒度并记忆到 sessionStorage
  function selectGranularity(id: string) {
    setGranularity(id);
    try {
      sessionStorage.setItem(GRANULARITY_KEY, id);
    } catch (e) {
      // 存储不可用：仅本次不记忆，不影响切换
    }
  }

  const { token } = theme.useToken();
  const toneColor = (tone: SeriesTone): string =>
    tone === 'primary'
      ? token.colorPrimary
      : tone === 'success'
        ? token.colorSuccess
        : tone === 'error'
          ? token.colorError
          : token.colorTextTertiary;
  const resolveSeries = (specs: SeriesSpec[]): ChartSeries[] =>
    specs.map((s) => ({ key: s.key, label: s.label, color: toneColor(s.tone), format: s.format }));
  // 占用率分级颜色（>80 红 / 60-80 橙 / <60 绿），颜色取自 antd 主题 token
  const barColor = (p?: number | null): string => {
    const t = toneFor(p);
    return t === 'hi' ? token.colorError : t === 'mid' ? token.colorWarning : token.colorSuccess;
  };

  // 进程树：按 pid/ppid 组树 + 同级排序（排序只作用在兄弟之间，防环在 buildProcTree 内）
  const processTree = useMemo(
    () => sortProcTree(buildProcTree(processes), procSort as ProcSortKey),
    [processes, procSort]
  );

  // 拿到第一份进程数据后一次性受控展开全部（antd 的 defaultExpandAllRows 在数据异步到达时
  // 不生效，故改受控）。autoExpandedRef 保证 5s 轮询刷新不再强制展开，保留用户手动折叠。
  useEffect(() => {
    if (autoExpandedRef.current || processes.length === 0) return;
    autoExpandedRef.current = true;
    setExpandedRowKeys(collectProcPids(processTree));
  }, [processes, processTree]);

  if (!data) {
    return (
      <div className="system">
        <div className="empty">{error || '加载中…'}</div>
      </div>
    );
  }

  const cpu = data.cpu || {};
  const memory = data.memory || {};
  const disk = data.disk || null;
  const network = data.network || null;
  const disk_io = data.disk_io || null;
  const { uptime, os, hostname } = data;
  const swap = memory.swapTotal ? memory : null;
  const zram = memory.zram || null;
  const psi = data.psi || {};
  // loadavg 防御：服务端可能给数组（[1,5,15]）或字符串/缺失，非数组不调用 .map 以免整页崩溃
  const loadavg = Array.isArray(cpu.loadavg)
    ? cpu.loadavg.map((v) => Number(v).toFixed(2)).join(' / ')
    : cpu.loadavg != null
      ? String(cpu.loadavg)
      : '—';

  const processColumns: TableColumnsType<ProcTreeNode<ProcessInfo>> = [
    {
      key: 'status',
      width: 32,
      align: 'center',
      render: (_: unknown, p: ProcTreeNode<ProcessInfo>) => {
        const down = services.find((s) => s.pid === p.pid)?.status === 'down';
        return <Badge status={down ? 'error' : 'success'} />;
      }
    },
    {
      title: '进程',
      dataIndex: 'name',
      ellipsis: true,
      render: (_: unknown, p: ProcTreeNode<ProcessInfo>) => {
        const kids = p.children ? p.children.length : 0;
        return (
          <span>
            {p.name}
            {showThreads && p.thread_count != null && (
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                {p.thread_count} 线程
              </Typography.Text>
            )}
            {kids > 0 && (
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                {p.subtree_count} 个进程 · {(Number(p.subtree_cpu) || 0).toFixed(1)}%
              </Typography.Text>
            )}
          </span>
        );
      }
    },
    { title: 'PID', dataIndex: 'pid', width: 96, align: 'right' },
    {
      title: '内存（含子进程）',
      dataIndex: 'subtree_mem_mb',
      width: 160,
      align: 'right',
      render: (v: number | undefined) => fmtMB(v)
    },
    {
      title: '自身',
      dataIndex: 'mem_mb',
      width: 120,
      align: 'right',
      render: (v: number | undefined) => fmtMB(v)
    },
    {
      title: 'CPU',
      dataIndex: 'cpu',
      width: 96,
      align: 'right',
      render: (v: number | undefined) => (Number(v) || 0).toFixed(1) + '%'
    }
  ];

  // 趋势数据源：秒档位沿用 SSE 实时 history；其它档位用聚合接口结果
  const trend = granularity === 'sec' ? history : trendPoints;
  const memSeries = resolveSeries(MEM_SPECS);
  const psiSeries = resolveSeries(PSI_SPECS);
  const netSeries = resolveSeries(NET_SPECS);
  const ioSeries = resolveSeries(IO_SPECS);

  return (
    <div className="system">
      <div className="system-head">
        <Typography.Title level={4} style={{ margin: 0 }}>
          系统监控
        </Typography.Title>
        <Typography.Text type="secondary">
          更新于 {updated ? updated.toLocaleTimeString('zh-CN') : '--'}
        </Typography.Text>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <Card title="CPU">
            <Typography.Title level={3} style={{ margin: '0 0 8px' }}>
              {cpu.usage_percent == null ? '—' : cpu.usage_percent + '%'}
            </Typography.Title>
            <Bar percent={cpu.usage_percent} color={barColor(cpu.usage_percent)} />
            <CoreGrid cores={cpu.per_core} colorOf={barColor} />
            <InfoRow k="型号" v={cpu.model} />
            <InfoRow k="核心数" v={cpu.cores} />
            <InfoRow k="进程" v={procTotalCount == null ? '—' : `${procTotalCount} 个`} />
            <InfoRow k="负载 (1/5/15m)" v={loadavg} />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <Card title="内存">
            <Typography.Title level={3} style={{ margin: '0 0 8px' }}>
              {memory.percent == null ? '—' : memory.percent + '%'}
            </Typography.Title>
            <Bar percent={memory.percent} color={barColor(memory.percent)} />
            <InfoRow k="已用（不含缓存）" v={fmtBytes(memory.used)} />
            <InfoRow k="可用" v={memory.available != null ? fmtBytes(memory.available) : '—'} />
            <InfoRow
              k="其中缓存（可回收）"
              v={memory.buffCache != null ? fmtBytes(memory.buffCache) : '—'}
            />
            <InfoRow k="剩余 / 总计" v={`${fmtBytes(memory.free)} / ${fmtBytes(memory.total)}`} />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <Card title="Swap">
            {swap ? (
              <>
                <Typography.Title level={3} style={{ margin: '0 0 8px' }}>
                  {memory.swapPercent + '%'}
                </Typography.Title>
                <Bar percent={memory.swapPercent} color={barColor(memory.swapPercent)} />
                <InfoRow k="已用" v={fmtBytes(memory.swapUsed)} />
                <InfoRow
                  k="剩余 / 总计"
                  v={`${fmtBytes(memory.swapFree)} / ${fmtBytes(memory.swapTotal)}`}
                />
                {zram ? (
                  <InfoRow k="zram (lz4)" v={`${fmtBytes(zram.used)} / ${fmtBytes(zram.total)}`} />
                ) : (
                  <InfoRow k="zram" v="无" />
                )}
              </>
            ) : (
              <>
                <Typography.Title level={3} type="secondary" style={{ margin: '0 0 8px' }}>
                  0%
                </Typography.Title>
                <Bar percent={0} color={barColor(0)} />
                <InfoRow k="zram" v="无" />
                <InfoRow k="备注" v="本机未配置 swap" />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <Card title="PSI 压力">
            <PsiRow k="内存 (memory)" o={psi.memory} danger={token.colorError} warn={token.colorWarning} />
            <PsiRow k="CPU" o={psi.cpu} danger={token.colorError} warn={token.colorWarning} />
            <PsiRow k="I/O" o={psi.io} danger={token.colorError} warn={token.colorWarning} />
            <InfoRow k="说明" v="avg10 压力 · some/full" />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <Card title="系统">
            <InfoRow k="主机名" v={hostname} />
            <InfoRow k="操作系统" v={os} />
            <InfoRow k="运行时长" v={fmtDuration(uptime)} />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <Card title="网络">
            <InfoRow k="↓ 下载" v={network ? fmtRate(network.rx_rate) : '—'} />
            <InfoRow k="↑ 上传" v={network ? fmtRate(network.tx_rate) : '—'} />
            <InfoRow k="累计下载" v={network ? fmtBytes(network.rx_bytes) : '—'} />
            <InfoRow k="累计上传" v={network ? fmtBytes(network.tx_bytes) : '—'} />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <Card title="磁盘 I/O">
            <InfoRow k="读" v={disk_io ? fmtRate(disk_io.read_rate) : '—'} />
            <InfoRow k="写" v={disk_io ? fmtRate(disk_io.write_rate) : '—'} />
            <InfoRow k="累计读" v={disk_io ? fmtBytes(disk_io.read_bytes) : '—'} />
            <InfoRow k="累计写" v={disk_io ? fmtBytes(disk_io.write_bytes) : '—'} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {Array.isArray(data.disks) && data.disks.length > 0
          ? data.disks.map((d, i) => (
              <Col xs={24} sm={12} lg={8} key={(d && d.mount ? d.mount : 'disk') + '-' + i}>
                <DiskCard
                  title={'磁盘 ' + (d && d.mount ? d.mount : '')}
                  disk={d || {}}
                  colorOf={barColor}
                />
              </Col>
            ))
          : disk && (
              <Col xs={24} sm={12} lg={8}>
                <DiskCard title="磁盘" disk={disk} colorOf={barColor} />
              </Col>
            )}
      </Row>

      {processes.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 12
            }}
          >
            <Typography.Title level={5} style={{ margin: 0 }}>
              进程排行
            </Typography.Title>
            <Space size={16} wrap>
              <Space size={6}>
                <Typography.Text type="secondary">含线程</Typography.Text>
                <Switch size="small" checked={showThreads} onChange={setShowThreads} />
              </Space>
              <Segmented
                size="small"
                value={procSort}
                onChange={(v) => setProcSort(String(v))}
                options={[
                  { label: '按名称', value: 'name' },
                  { label: '内存（含子进程）', value: 'mem' },
                  { label: '按自身', value: 'own' },
                  { label: '按 CPU', value: 'cpu' }
                ]}
              />
            </Space>
          </div>
          {(procTruncated || procSkippedCount > 0) && (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              {procTruncated ? '进程数超过上限，列表已按内存截断' : ''}
              {procTruncated && procSkippedCount > 0 ? '；' : ''}
              {procSkippedCount > 0 ? `ps 有 ${procSkippedCount} 行未能解析` : ''}
            </Typography.Text>
          )}
          <Table<ProcTreeNode<ProcessInfo>>
            rowKey="pid"
            size="small"
            columns={processColumns}
            dataSource={processTree}
            pagination={false}
            expandable={{
              expandedRowKeys,
              onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]),
              expandIconColumnIndex: 1
            }}
            scroll={{ x: 'max-content', y: '60vh' }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} />
                <Table.Summary.Cell index={1}>合计（全部进程）</Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  {procTotalCount == null ? '—' : `${procTotalCount} 个进程`}
                  {procTotalThreads != null ? ` · ${procTotalThreads} 个线程` : ''}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  <span>{procTotalMemMb == null ? '—' : fmtMB(procTotalMemMb)}</span>
                  <Typography.Text type="secondary" style={{ display: 'block' }}>
                    RSS 合计，含共享页重复计算
                  </Typography.Text>
                  {procTotalCgroupMb != null && (
                    <Typography.Text type="secondary" style={{ display: 'block' }}>
                      cgroup 真值 {fmtMB(procTotalCgroupMb)}
                    </Typography.Text>
                  )}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  {procTotalMemMb == null ? '—' : fmtMB(procTotalMemMb)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  {totalCpu == null ? '—' : Number(totalCpu).toFixed(1) + '%'}
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 12
          }}
        >
          <Typography.Title level={5} style={{ margin: 0 }}>
            趋势
          </Typography.Title>
          <Segmented
            value={granularity}
            onChange={(v) => selectGranularity(String(v))}
            options={GRANULARITY_OPTIONS.map((g) => ({ label: g.label, value: g.id }))}
          />
        </div>

        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Card title="CPU / 内存 / Swap（%）">
              <Legend series={memSeries} data={trend} />
              <TrendChart
                data={trend}
                series={memSeries}
                yMax={100}
                yLabel="%"
                granularity={granularity}
                chartId="mem"
                recordedMinutes={trendRecordedMinutes}
              />
            </Card>
          </Col>
          <Col span={24}>
            <Card title="PSI 压力 · some avg10（%）">
              <Legend series={psiSeries} data={trend} />
              <TrendChart
                data={trend}
                series={psiSeries}
                yMax={100}
                yLabel="%"
                granularity={granularity}
                chartId="psi"
                recordedMinutes={trendRecordedMinutes}
              />
            </Card>
          </Col>
          <Col span={24}>
            <Card title="网速（/s）">
              <Legend series={netSeries} data={trend} />
              <TrendChart
                data={trend}
                series={netSeries}
                granularity={granularity}
                chartId="net"
                recordedMinutes={trendRecordedMinutes}
              />
            </Card>
          </Col>
          <Col span={24}>
            <Card title="磁盘 I/O（/s）">
              <Legend series={ioSeries} data={trend} />
              <TrendChart
                data={trend}
                series={ioSeries}
                granularity={granularity}
                chartId="io"
                recordedMinutes={trendRecordedMinutes}
              />
            </Card>
          </Col>
        </Row>
      </div>
    </div>
  );
}
