/**
 * System —— 「系统」Tab 面板：监控总览（KPI 带 + 主趋势 + PSI + Top 表 + 告警审计）。
 *
 * 数据来源：
 * - 实时指标 / PSI / 卡顿指数 / Top 服务走 SSE `/api/admin/system/stream`（仅 Tab 激活时建连）；
 * - Top 进程走 REST `/api/admin/services`，激活时每 5s 取样（SSE 不再携带进程明细）；
 * - 主趋势走 `/api/admin/system/metrics`，按 1h / 6h / 24h / 7d 切换；
 * - 失败单元 / 最近登录 / 端口服务走 `/api/admin/system/info`，每 60s 刷新。
 *
 * KPI 迷你趋势用本页的滚动缓冲（最多 60 个快照），首帧用 SSE 自带的 history 补齐
 * CPU / 内存；磁盘、卡顿指数、运行队列没有历史列，等页面积累后自然成形，不伪造数据。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Spin, Typography } from 'antd';
import { getServices, getSystemInfo, getSystemMetrics } from '../api';
import type { HistoryPoint, ProcessInfo, SystemData, SystemInfoResponse } from '../api';
import { fmtBytes, fmtDuration } from '../format';
import {
  monitorRangeSpec,
  pickRootDisk,
  stallTone,
  thresholdTone,
  type MonitorRange,
  type ValueTone
} from '../monitor';
import { KpiCard } from './MonitorKpi';
import MonitorTrend from './MonitorTrend';
import MonitorPressure from './MonitorPressure';
import { TopProcesses, TopServices } from './MonitorTables';
import MonitorAudit from './MonitorAudit';

/** SSE snapshot 帧结构 */
interface SystemSnapshot {
  system?: SystemData;
  history?: HistoryPoint[];
}

/** KPI 迷你趋势的一帧；缺列保留 null，不当成 0。 */
interface SparkSample {
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  stall: number | null;
  runqueue: number | null;
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 从一份系统快照里取出五条迷你趋势各自的当前值。 */
function sparkSampleOf(data: SystemData | null | undefined): SparkSample {
  const disk = pickRootDisk(data?.disks, data?.disk);
  return {
    cpu: numOrNull(data?.cpu?.usage_percent),
    mem: numOrNull(data?.memory?.percent),
    disk: numOrNull(disk?.percent),
    stall: numOrNull(data?.stall_score),
    runqueue: numOrNull(data?.cpu?.run_queue)
  };
}

/** 百分比文本：非法值统一破折号，避免出现 `NaN%` / `—%`。 */
function pct1(value: unknown): string {
  if (value == null) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) + '%' : '—';
}

/** 带档位圆点的 KPI 副行；颜色不是唯一语义，文字始终存在。 */
function StallDetail({ level, psi }: { level?: string | null; psi?: number | null }) {
  const tone = stallTone(level);
  const color = tone === 'error' ? 'var(--ant-color-error)' : tone === 'warning' ? 'var(--ant-color-warning)' : 'var(--ant-color-success)';
  return (
    <span className="monitor-kpi-level">
      <i className="monitor-kpi-dot" style={{ background: color }} />
      {level || '—'}
      {psi == null ? '' : ` · ${(Number(psi) || 0).toFixed(1)}% 时间在等 CPU`}
    </span>
  );
}

export default function System({ active }: { active: boolean }) {
  const [data, setData] = useState<SystemData | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [info, setInfo] = useState<SystemInfoResponse | null>(null);
  const [infoError, setInfoError] = useState('');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<Date | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [range, setRange] = useState<MonitorRange>('24h');
  const [trendPoints, setTrendPoints] = useState<HistoryPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [spark, setSpark] = useState<SparkSample[]>([]);

  const sparkRef = useRef<SparkSample[]>([]);
  const sparkSeededRef = useRef(false);
  const trendCacheRef = useRef<Partial<Record<MonitorRange, HistoryPoint[]>>>({});

  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  // 系统 SSE：Tab 激活时才建连；手动刷新时重连一次。断开后 5s 自动重试。
  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;

    function parseFrame(frame: string) {
      let event: string | null = null;
      let payload: string | null = null;
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) payload = line.slice(5).trim();
      }
      if (event !== 'snapshot' || payload == null) return;
      let snapshot: SystemSnapshot;
      try {
        snapshot = JSON.parse(payload) as SystemSnapshot;
      } catch {
        return;
      }
      if (!snapshot || snapshot.system == null) return;

      setData(snapshot.system);
      const current = sparkSampleOf(snapshot.system);
      if (!sparkSeededRef.current) {
        // 首帧：CPU / 内存用 SSE 历史的真实序列补齐；其余指标没有历史列，只放当前点。
        const history = Array.isArray(snapshot.history) ? snapshot.history.slice(-60) : [];
        const seed = history.map<SparkSample>((point) => ({
          cpu: numOrNull(point.cpu),
          mem: numOrNull(point.mem_percent),
          disk: null,
          stall: null,
          runqueue: null
        }));
        sparkRef.current = [...seed, current].slice(-60);
        sparkSeededRef.current = true;
      } else {
        sparkRef.current = [...sparkRef.current, current].slice(-60);
      }
      setSpark(sparkRef.current);
      setUpdated(new Date());
      setError('');
    }

    async function connect() {
      if (disposed) return;
      ctrl = new AbortController();
      try {
        const resp = await fetch('/api/admin/system/stream', { signal: ctrl.signal });
        if (!resp.ok || !resp.body) throw new Error('SSE HTTP ' + resp.status);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!disposed && !ctrl.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index = buffer.indexOf('\n\n');
          while (index !== -1) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (frame) parseFrame(frame);
            index = buffer.indexOf('\n\n');
          }
        }
      } catch {
        if (disposed || ctrl?.signal.aborted) return;
      }
      if (disposed || ctrl?.signal.aborted) return;
      setError('连接已断开，正在重连…');
      retryTimer = setTimeout(connect, 5000);
    }

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ctrl?.abort();
    };
  }, [active, refreshTick]);

  // Top 进程：每 5s 一次；页面隐藏时停表，回前台立即补一次。
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let ctrl: AbortController | null = null;

    async function load() {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const result = await getServices({ signal: ctrl.signal });
        if (disposed) return;
        setProcesses(Array.isArray(result.processes) ? result.processes : []);
      } catch {
        // 失败保留上一帧，等待下个周期重试
      }
    }
    const start = () => {
      if (timer !== null) return;
      load();
      timer = setInterval(load, 5000);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      ctrl?.abort();
      ctrl = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [active, refreshTick]);

  // 概况（失败单元 / 登录 / 端口）：60s 一次，失败时保留旧内容并给出灰色降级说明。
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let ctrl: AbortController | null = null;

    async function load() {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const result = await getSystemInfo({ signal: ctrl?.signal });
        if (disposed) return;
        setInfo(result);
        setInfoError('');
      } catch {
        if (disposed || ctrl?.signal.aborted) return;
        setInfoError('系统概况加载失败');
      }
    }
    const start = () => {
      if (timer !== null) return;
      load();
      timer = setInterval(load, 60000);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      ctrl?.abort();
      ctrl = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [active, refreshTick]);

  // 主趋势：切换范围立即拉一次，之后按该范围的节奏刷新；缓存上次结果避免切回时闪空。
  useEffect(() => {
    if (!active) return;
    const spec = monitorRangeSpec(range);
    const cached = trendCacheRef.current[range];
    if (cached) setTrendPoints(cached);
    else setTrendPoints([]);
    setTrendLoading(!cached);

    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const result = await getSystemMetrics(spec.range, spec.step);
        if (disposed) return;
        const points = Array.isArray(result.points) ? result.points : [];
        trendCacheRef.current[range] = points;
        setTrendPoints(points);
      } catch {
        // 失败保留上一帧，等待下次刷新重试
      } finally {
        if (!disposed) setTrendLoading(false);
      }
    }

    load();
    timer = setInterval(load, spec.refreshMs);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [active, range, refreshTick]);

  const rootDisk = useMemo(() => pickRootDisk(data?.disks, data?.disk), [data?.disks, data?.disk]);

  const cpu = data?.cpu;
  const memory = data?.memory;
  const stallScore = numOrNull(data?.stall_score);
  const runQueue = numOrNull(cpu?.run_queue);
  const cores = numOrNull(cpu?.cores);
  const cpuPsi60 = numOrNull(data?.psi?.cpu?.some?.avg60);
  const cpuTone = thresholdTone(cpu?.usage_percent, 70, 85);
  const memTone = thresholdTone(memory?.percent, 80, 90);
  const diskTone = thresholdTone(rootDisk?.percent, 75, 85);
  const queueTone: ValueTone =
    runQueue != null && cores != null && cores > 0
      ? thresholdTone(runQueue, cores, cores * 1.5)
      : 'normal';

  const sparkCpu = spark.map((sample) => sample.cpu);
  const sparkMem = spark.map((sample) => sample.mem);
  const sparkDisk = spark.map((sample) => sample.disk);
  const sparkStall = spark.map((sample) => sample.stall);
  const sparkQueue = spark.map((sample) => sample.runqueue);

  const host = info?.hostname || data?.hostname;
  const osName = info?.os || data?.os;
  const uptime = info?.uptimeSeconds ?? data?.uptime;
  const diskDetail: ReactNode = rootDisk
    ? `${rootDisk.mount || '/'} ${fmtBytes(rootDisk.used)} / ${fmtBytes(rootDisk.total)}`
    : '—';

  return (
    <div className="system monitor-page">
      <div className="system-head monitor-head">
        <div className="monitor-head-title">
          <Typography.Title level={4} style={{ margin: 0 }}>
            系统监控
          </Typography.Title>
          <Typography.Text type="secondary" className="monitor-head-sub">
            {host || '—'} · {osName || '—'} · 运行 {fmtDuration(uptime)}
          </Typography.Text>
        </div>
        <div className="monitor-head-actions">
          <Typography.Text type="secondary" className="monitor-num">
            更新于 {updated ? updated.toLocaleTimeString('zh-CN') : '—'}
          </Typography.Text>
          <Button size="small" onClick={refresh}>
            刷新
          </Button>
        </div>
      </div>

      {error && <Alert type="error" showIcon message={error} />}

      {!data && !error && (
        <div className="monitor-boot" role="status">
          <Spin size="small" />
          <Typography.Text type="secondary">正在读取系统指标</Typography.Text>
        </div>
      )}

      <div className="monitor-kpis">
        <KpiCard
          label="CPU"
          value={cpu?.usage_percent == null ? '—' : pct1(cpu.usage_percent)}
          detail={`15s ${pct1(cpu?.usage_15s)} · 60s ${pct1(cpu?.usage_60s)}`}
          spark={sparkCpu}
          tone={cpuTone}
        />
        <KpiCard
          label="内存"
          value={memory?.percent == null ? '—' : pct1(memory.percent)}
          detail={`${fmtBytes(memory?.used)} / ${fmtBytes(memory?.total)}`}
          spark={sparkMem}
          tone={memTone}
        />
        <KpiCard
          label="磁盘"
          value={rootDisk?.percent == null ? '—' : pct1(rootDisk.percent)}
          detail={diskDetail}
          spark={sparkDisk}
          tone={diskTone}
        />
        <KpiCard
          label="卡顿指数"
          value={stallScore == null ? '—' : stallScore.toFixed(1)}
          detail={<StallDetail level={data?.stall_level} psi={cpuPsi60} />}
          spark={sparkStall}
          tone={stallTone(data?.stall_level)}
        />
        <KpiCard
          label="运行队列"
          value={`${runQueue == null ? '—' : runQueue} / ${cores == null ? '—' : cores}`}
          detail={`${cores == null ? '—' : cores} 核 · 阻塞 ${cpu?.blocked == null ? '—' : cpu.blocked}`}
          spark={sparkQueue}
          tone={queueTone}
        />
      </div>

      <div className="monitor-main">
        <div className="monitor-span-8">
          <MonitorTrend
            range={range}
            onRangeChange={setRange}
            points={trendPoints}
            loading={trendLoading}
          />
        </div>
        <div className="monitor-span-4">
          <MonitorPressure data={data} />
        </div>
      </div>

      <div className="monitor-tables">
        <div className="monitor-span-7">
          <TopProcesses processes={processes} />
        </div>
        <div className="monitor-span-5">
          <TopServices services={data?.top_services ?? []} />
        </div>
      </div>

      <MonitorAudit info={info} error={infoError} />
    </div>
  );
}
