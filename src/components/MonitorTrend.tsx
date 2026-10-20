/**
 * MonitorTrend —— 监控页主趋势图：指标切换（CPU / 内存 / 磁盘 / 网络 / 磁盘IO）+
 * 时间范围切换（1h / 6h / 24h / 7d）。
 *
 * 数据由父级按 `MONITOR_RANGES` 请求 `/api/admin/system/metrics` 后传入；本组件只负责
 * 把点集转成 ECharts option。颜色全部来自 antd token，ECharts 实例在主题切换时由
 * `Chart` 内部重建，因此暗色下文字 / 轴线无需额外处理。
 *
 * 磁盘使用率取后端新增的 `disk_percent` 列；网络 / 磁盘 IO 为两个速率系列（B/s），
 * 缺列时折线断开，不把缺失当成 0。
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { Card, Segmented, Spin, Typography, theme } from 'antd';
import type { HistoryPoint } from '../api';
import {
  MONITOR_METRICS,
  MONITOR_RANGES,
  columnValues,
  formatTrendTick,
  trendMetricSpec,
  withAlpha,
  type MonitorRange,
  type TrendMetric
} from '../monitor';
import { fmtPct, fmtRate, niceMax } from '../format';
import type { EChartsOption } from './Chart';

// echarts 体积大，保持与旧版一致的动态载入：只有监控页真正画图时才下载。
const Chart = lazy(() => import('./Chart'));

export interface MonitorTrendProps {
  /** 当前时间范围 */
  range: MonitorRange;
  /** 切换范围（父级据此重新请求） */
  onRangeChange: (range: MonitorRange) => void;
  /** 当前范围的点位 */
  points: HistoryPoint[];
  /** 首次请求尚未返回时为 true */
  loading: boolean;
}

interface TooltipParam {
  axisValueLabel?: string;
  seriesName?: string;
  value?: unknown;
  marker?: string;
}

/** 一组数值的峰值 / 均值 / 当前值，空集返回 null。 */
function summarize(values: Array<number | null>): { peak: number; avg: number; current: number } | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return {
    peak: Math.max(...nums),
    avg: nums.reduce((sum, v) => sum + v, 0) / nums.length,
    current: nums[nums.length - 1]
  };
}

/**
 * 主趋势卡片。
 * @param props 见 {@link MonitorTrendProps}
 */
export default function MonitorTrend({ range, onRangeChange, points, loading }: MonitorTrendProps) {
  const { token } = theme.useToken();
  const [metric, setMetric] = useState<TrendMetric>('cpu');
  const spec = trendMetricSpec(metric);

  const seriesValues = useMemo(
    () => spec.keys.map((key) => columnValues(points, key)),
    [points, spec.keys]
  );

  const option = useMemo<EChartsOption>(() => {
    const labels = points.map((point) => formatTrendTick(point.ts, range));
    // 全量点位下固定给 5 个刻度；dataZoom 缩放时不额外增加，避免横轴拥挤。
    const labelInterval = Math.max(0, Math.ceil(points.length / 5) - 1);
    const colors = [token.colorPrimary, token.colorSuccess];
    const axisLabel = { color: token.colorTextTertiary, fontSize: 11 };
    const rateMax = Math.max(
      1,
      ...seriesValues.flatMap((values) => values.map((v) => (v == null ? 0 : v)))
    );
    const yMax = spec.unit === 'percent' ? 100 : niceMax(rateMax);
    const formatValue = (raw: unknown) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return '—';
      return spec.unit === 'percent' ? fmtPct(n) + '%' : fmtRate(n);
    };

    return {
      animation: false,
      grid: { left: 8, right: 8, top: 16, bottom: 24, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: token.colorBgElevated,
        borderColor: token.colorBorderSecondary,
        textStyle: { color: token.colorText, fontSize: 12 },
        extraCssText: `border-radius: ${token.borderRadiusLG}px; box-shadow: none;`,
        formatter: (params: unknown) => {
          const list = (Array.isArray(params) ? params : []) as TooltipParam[];
          if (!list.length) return '';
          const time = list[0].axisValueLabel || '';
          const rows = list
            .map((item) => `${item.marker || ''}${item.seriesName || ''} ${formatValue(item.value)}`)
            .join('<br/>');
          return `${time}<br/>${rows}`;
        }
      },
      legend: { show: false },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: token.colorBorderSecondary } },
        axisLabel: { ...axisLabel, interval: labelInterval, hideOverlap: true }
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: yMax,
        splitNumber: 4,
        axisLabel: {
          ...axisLabel,
          formatter: (value: number) =>
            spec.unit === 'percent' ? value + '%' : fmtRate(value)
        },
        splitLine: { lineStyle: { color: token.colorBorderSecondary } }
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          zoomOnMouseWheel: false,
          moveOnMouseWheel: true,
          moveOnMouseMove: true,
          preventDefaultMouseMove: false
        }
      ],
      series: spec.series.map((name, index) => {
        const color = colors[index] ?? token.colorPrimary;
        return {
          name,
          type: 'line' as const,
          smooth: 0.25,
          showSymbol: false,
          symbol: 'none',
          sampling: 'lttb' as const,
          lineStyle: { width: 1.5, color },
          itemStyle: { color },
          areaStyle: index === 0
            ? {
                color: {
                  type: 'linear' as const,
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: withAlpha(color, 0.16) },
                    { offset: 1, color: withAlpha(color, 0) }
                  ]
                }
              }
            : undefined,
          data: seriesValues[index] ?? []
        };
      })
    };
  }, [points, range, spec, seriesValues, token]);

  const summaries = useMemo(
    () => seriesValues.map((values, index) => ({ name: spec.series[index], summary: summarize(values) })),
    [seriesValues, spec.series]
  );
  const isEmpty = points.length === 0;
  const colors = [token.colorPrimary, token.colorSuccess];

  return (
    <Card className="monitor-card" title="趋势" style={{ height: '100%' }}>
      <div className="monitor-toolbar monitor-trend-toolbar">
        <Segmented
          size="small"
          value={metric}
          onChange={(value) => setMetric(String(value) as TrendMetric)}
          options={MONITOR_METRICS.map((item) => ({ label: item.label, value: item.id }))}
        />
        <Segmented
          size="small"
          value={range}
          onChange={(value) => onRangeChange(String(value) as MonitorRange)}
          options={MONITOR_RANGES.map((item) => ({ label: item.label, value: item.id }))}
        />
      </div>

      <div className="monitor-legend" aria-hidden="true">
        {spec.series.map((name, index) => (
          <span className="monitor-legend-item" key={name}>
            <i className="monitor-legend-dot" style={{ background: colors[index] ?? token.colorPrimary }} />
            {name}
          </span>
        ))}
      </div>

      {isEmpty ? (
        <div className="monitor-empty" role="status">
          {loading ? <Spin size="small" /> : <Typography.Text type="secondary">—</Typography.Text>}
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="monitor-empty">
              <Spin size="small" />
            </div>
          }
        >
          <Chart option={option} height={260} loading={loading} />
        </Suspense>
      )}

      <div className="monitor-summary">
        {summaries.map(({ name, summary }) => (
          <span key={name}>
            {name} 峰值 {summary ? (spec.unit === 'percent' ? fmtPct(summary.peak) + '%' : fmtRate(summary.peak)) : '—'} ·
            均值 {summary ? (spec.unit === 'percent' ? fmtPct(summary.avg) + '%' : fmtRate(summary.avg)) : '—'} · 当前{' '}
            {summary ? (spec.unit === 'percent' ? fmtPct(summary.current) + '%' : fmtRate(summary.current)) : '—'}
          </span>
        ))}
      </div>
    </Card>
  );
}
