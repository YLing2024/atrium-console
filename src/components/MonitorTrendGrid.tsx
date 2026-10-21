/**
 * MonitorTrendGrid —— 多图共享时间轴的趋势区。
 *
 * 借鉴 Netdata 的做法：不把多个指标塞进一张双轴图，而是每个指标一张小图，
 * 通过 `echarts.connect(group)` 让「缩放 / 拖选 / 悬停十字线」在全组同步。
 *
 * 数据仍来自父级的 `/api/admin/system/metrics`，本组件只负责呈现。
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Segmented, Space, Typography, theme } from 'antd';
import { navigate } from '../router';
import Chart, { type EChartsOption } from './Chart';
import type { HistoryPoint } from '../api';
import { MONITOR_RANGES, type MonitorRange } from '../monitor';
import { request } from '../api';

interface Props {
  range: MonitorRange;
  onRangeChange: (r: MonitorRange) => void;
  points: HistoryPoint[];
  loading?: boolean;
}

const GROUP = 'monitor-trend';

/** 趋势面板 → anomaly_events.metric 的对应关系。 */
const ANOMALY_KEY: Record<string, string> = {
  cpu: 'cpu_percent',
  mem: 'mem_percent',
  disk: 'disk_percent',
  net: 'net_rx_rate'
};

interface AnomalyEvent {
  ts: string;
  metric: string;
  value: number;
}

interface Panel {
  key: string;
  title: string;
  unit: string;
  colors: string[];
  fields: string[];
}

/** 四张小图：CPU / 内存 / 磁盘 / 网络。字段名与 /metrics 返回一致。 */
const PANELS: Panel[] = [
  { key: 'cpu', title: 'CPU', unit: '%', colors: ['primary'], fields: ['cpu'] },
  { key: 'mem', title: '内存', unit: '%', colors: ['success'], fields: ['mem_percent'] },
  { key: 'disk', title: '磁盘', unit: '%', colors: ['warning'], fields: ['disk_percent'] },
  {
    key: 'net',
    title: '网络',
    unit: 'B/s',
    colors: ['primary', 'error'],
    fields: ['net_rx_rate', 'net_tx_rate']
  }
];

/** 时间刻度：按范围决定只显示时分还是月日。 */
function tickLabel(ts: number, range: MonitorRange): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (range === '1h' || range === '6h') return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 网络字节速率 → 人类可读。 */
function fmtRate(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB/s`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB/s`;
  return `${Math.round(v)} B/s`;
}

export default function MonitorTrendGrid({ range, onRangeChange, points, loading }: Props) {
  const { token } = theme.useToken();

  const [anomalies, setAnomalies] = useState<AnomalyEvent[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await request<{ items: AnomalyEvent[] }>('/api/admin/anomalies?limit=200');
        if (alive) setAnomalies(res.items ?? []);
      } catch {
        /* 异常接口失败不影响趋势图 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const labels = useMemo(() => points.map((p) => tickLabel(p.ts, range)), [points, range]);

  const palette = useMemo(
    () => ({
      primary: token.colorPrimary,
      success: token.colorSuccess,
      warning: token.colorWarning,
      error: token.colorError
    }),
    [token]
  );

  const buildOption = (panel: Panel): EChartsOption => {
    const series = panel.fields.map((field, i) => ({
      name: field,
      type: 'line' as const,
      smooth: 0.25,
      symbol: 'none',
      lineStyle: { width: 1.5 },
      areaStyle: { opacity: 0.08 },
      itemStyle: { color: palette[panel.colors[i] as keyof typeof palette] },
      data: points.map((p) => (typeof p[field] === 'number' ? p[field] : null)),
      // 该指标的基线异常点：找到时间最接近的横轴位置打点
      markPoint: (() => {
        const key = ANOMALY_KEY[panel.key];
        const marks: Array<{ name: string; coord: [number, number]; value: string }> = [];
        for (const a of anomalies) {
          if (a.metric !== key) continue;
          const t = new Date(a.ts).getTime();
          let best = -1;
          let bestDiff = Infinity;
          points.forEach((p, idx) => {
            const d = Math.abs(p.ts - t);
            if (d < bestDiff) {
              bestDiff = d;
              best = idx;
            }
          });
          if (best >= 0) marks.push({ name: '异常', coord: [best, a.value], value: '!' });
        }
        if (marks.length === 0) return undefined;
        return {
          symbol: 'pin',
          symbolSize: 22,
          itemStyle: { color: token.colorError },
          label: { fontSize: 10, color: '#fff' },
          data: marks
        };
      })()
    }));

    return {
      animation: false,
      grid: { left: 8, right: 8, top: 16, bottom: 20, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: token.colorTextTertiary } },
        valueFormatter: (v) =>
          panel.unit === 'B/s' ? fmtRate(Number(v)) : `${Number(v).toFixed(1)}${panel.unit}`
      },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: token.colorBorderSecondary } },
        axisTick: { show: false },
        axisLabel: {
          color: token.colorTextTertiary,
          fontSize: 10,
          interval: Math.max(0, Math.floor(labels.length / 5) - 1)
        }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: token.colorTextTertiary,
          fontSize: 10,
          formatter: (v: number) => (panel.unit === 'B/s' ? fmtRate(v) : `${v}%`)
        },
        splitLine: { lineStyle: { color: token.colorSplit, type: 'dashed' } }
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true
        }
      ],
      series
    };
  };

  return (
    <Card
      className="monitor-card"
      title="趋势"
      extra={
        <Space size={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            拖选或滚轮缩放，四张图同步
          </Typography.Text>
          <Segmented
            size="small"
            value={range}
            onChange={(v) => onRangeChange(v as MonitorRange)}
            options={MONITOR_RANGES.map((r) => ({ label: r.label, value: r.id }))}
          />
        </Space>
      }
      loading={loading}
    >
      <div className="monitor-trend-grid">
        {PANELS.map((panel) => (
          <div className="monitor-trend-cell" key={panel.key}>
            <div className="monitor-trend-cell-head">
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: 'auto', fontSize: 12 }}
                onClick={() => navigate(`/metrics/${panel.key}`)}
              >
                {panel.title} ›
              </Button>
              <span className="monitor-trend-cell-unit">{panel.unit === 'B/s' ? '↓/↑' : '%'}</span>
            </div>
            <Chart group={GROUP} height={132} option={buildOption(panel)} />
          </div>
        ))}
      </div>
    </Card>
  );
}
