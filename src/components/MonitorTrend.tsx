/**
 * MonitorTrend —— 监控页主趋势图：CPU（左轴）与内存（右轴）双系列 + 1h/6h/24h/7d 切换。
 *
 * 数据由父级按 `MONITOR_RANGES` 请求 `/api/admin/system/metrics` 后传入；本组件只负责
 * 把点集转成 ECharts option。颜色全部来自 antd token，ECharts 实例在主题切换时由
 * `Chart` 内部重建，因此暗色下文字 / 轴线无需额外处理。
 *
 * 交互：`dataZoom(type: 'inside')` 只保留滚轮 / 拖动平移，不放滑条；图例用页面内的
 * 文本摘要承担（canvas 图表的可访问性有限）。
 */
import { lazy, Suspense, useMemo } from 'react';
import { Card, Segmented, Spin, Typography, theme } from 'antd';
import type { HistoryPoint } from '../api';
import {
  MONITOR_RANGES,
  columnValues,
  formatTrendTick,
  withAlpha,
  type MonitorRange
} from '../monitor';
import { fmtPct } from '../format';
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

  const option = useMemo<EChartsOption>(() => {
    const cpuValues = columnValues(points, 'cpu');
    const memValues = columnValues(points, 'mem_percent');
    const labels = points.map((point) => formatTrendTick(point.ts, range));
    // 全量点位下固定给 5 个刻度；dataZoom 缩放时不额外增加，避免横轴拥挤。
    const labelInterval = Math.max(0, Math.ceil(points.length / 5) - 1);
    const cpuColor = token.colorPrimary;
    const memColor = token.colorSuccess;
    const axisLabel = { color: token.colorTextTertiary, fontSize: 11 };

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
            .map((item) => {
              const n = Number(item.value);
              const value = Number.isFinite(n) ? fmtPct(n) + '%' : '—';
              return `${item.marker || ''}${item.seriesName || ''} ${value}`;
            })
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
      yAxis: [
        {
          type: 'value',
          min: 0,
          max: 100,
          splitNumber: 4,
          axisLabel: { ...axisLabel, formatter: '{value}%' },
          splitLine: { lineStyle: { color: token.colorBorderSecondary } }
        },
        {
          type: 'value',
          min: 0,
          max: 100,
          splitNumber: 4,
          axisLabel: { show: false },
          splitLine: { show: false }
        }
      ],
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
      series: [
        {
          name: 'CPU',
          type: 'line',
          yAxisIndex: 0,
          smooth: 0.25,
          showSymbol: false,
          symbol: 'none',
          sampling: 'lttb',
          lineStyle: { width: 1.5, color: cpuColor },
          itemStyle: { color: cpuColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(cpuColor, 0.16) },
                { offset: 1, color: withAlpha(cpuColor, 0) }
              ]
            }
          },
          data: cpuValues
        },
        {
          name: '内存',
          type: 'line',
          yAxisIndex: 1,
          smooth: 0.25,
          showSymbol: false,
          symbol: 'none',
          sampling: 'lttb',
          lineStyle: { width: 1.5, color: memColor },
          itemStyle: { color: memColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(memColor, 0.1) },
                { offset: 1, color: withAlpha(memColor, 0) }
              ]
            }
          },
          data: memValues
        }
      ]
    };
  }, [points, range, token]);

  const cpuSummary = useMemo(() => summarize(columnValues(points, 'cpu')), [points]);
  const memSummary = useMemo(() => summarize(columnValues(points, 'mem_percent')), [points]);
  const isEmpty = points.length === 0;

  return (
    <Card className="monitor-card" title="CPU 与内存" style={{ height: '100%' }}>
      <div className="monitor-toolbar">
        <div className="monitor-legend" aria-hidden="true">
          <span className="monitor-legend-item">
            <i className="monitor-legend-dot" style={{ background: token.colorPrimary }} />
            CPU
          </span>
          <span className="monitor-legend-item">
            <i className="monitor-legend-dot" style={{ background: token.colorSuccess }} />
            内存
          </span>
        </div>
        <Segmented
          size="small"
          value={range}
          onChange={(value) => onRangeChange(String(value) as MonitorRange)}
          options={MONITOR_RANGES.map((item) => ({ label: item.label, value: item.id }))}
        />
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
        <span>
          CPU 峰值 {cpuSummary ? fmtPct(cpuSummary.peak) + '%' : '—'} · 均值{' '}
          {cpuSummary ? fmtPct(cpuSummary.avg) + '%' : '—'} · 当前{' '}
          {cpuSummary ? fmtPct(cpuSummary.current) + '%' : '—'}
        </span>
        <span>
          内存当前 {memSummary ? fmtPct(memSummary.current) + '%' : '—'}
        </span>
      </div>
    </Card>
  );
}
