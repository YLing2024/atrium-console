/**
 * MonitorKpi —— 监控页顶部 KPI 卡与 40×28 迷你趋势线（sparkline）。
 *
 * 设计要点：
 * - 卡片等高、无阴影、圆角 8，内边距 16；数字统一 `tabular-nums`，刷新时不跳动；
 * - 迷你线只表达形状：无坐标轴 / 网格 / 标签，线宽 1.5，下方 8% 透明度渐变填充；
 * - 常态用主色，越过阈值才切 warning / error；无数据时主数字显示破折号，不显示 0。
 */
import { useId, type ReactNode } from 'react';
import { Card, Typography, theme } from 'antd';
import { buildSparkGeometry, type ValueTone } from '../monitor';

/** KPI 卡片的语义色档位 */
export type KpiTone = ValueTone;

export interface SparklineProps {
  /** 最近若干采样值；缺列可为 null */
  values: ReadonlyArray<number | null | undefined>;
  /** 线条颜色（来自 antd token） */
  color: string;
  /** 宽，默认 40 */
  width?: number;
  /** 高，默认 28 */
  height?: number;
}

/**
 * 极简迷你趋势线。
 *
 * 以 SVG 绘制而不是再开一个 ECharts 实例：5 张卡各 40×28，实例开销远大于收益。
 * 只有一个有效点时画一个圆点；没有有效点时保留空白占位，不伪造基线。
 *
 * 可访问性：图形本身 `aria-hidden`，数值由卡片正文的文字承担语义。
 */
export function Sparkline({ values, color, width = 40, height = 28 }: SparklineProps) {
  const gradientId = useId().replace(/:/g, '');
  const geometry = buildSparkGeometry(values, width, height);
  if (!geometry) {
    return <svg className="monitor-spark" width={width} height={height} aria-hidden="true" />;
  }
  if (geometry.point) {
    return (
      <svg className="monitor-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <circle cx={geometry.point.x} cy={geometry.point.y} r={1.5} fill={color} />
      </svg>
    );
  }
  return (
    <svg
      className="monitor-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.08} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={geometry.area} fill={`url(#${gradientId})`} />
      <polyline
        points={geometry.line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export interface KpiCardProps {
  /** 指标名（12px 次级色） */
  label: string;
  /** 主数字；无数据时传 `—` */
  value: string;
  /** 副行说明（12px 次级色） */
  detail: ReactNode;
  /** 迷你线采样值 */
  spark: ReadonlyArray<number | null | undefined>;
  /** 语义档位，默认 normal */
  tone?: KpiTone;
}

/**
 * 单张 KPI 卡。
 * @param props 见 {@link KpiCardProps}
 */
export function KpiCard({ label, value, detail, spark, tone = 'normal' }: KpiCardProps) {
  const { token } = theme.useToken();
  const color =
    tone === 'error'
      ? token.colorError
      : tone === 'warning'
        ? token.colorWarning
        : token.colorPrimary;
  return (
    <Card className="monitor-kpi-card" style={{ height: '100%' }}>
      <div className="monitor-kpi-top">
        <Typography.Text type="secondary" className="monitor-kpi-label">
          {label}
        </Typography.Text>
        <Sparkline values={spark} color={color} />
      </div>
      <div className="monitor-kpi-value">{value}</div>
      <div className="monitor-kpi-detail">{detail}</div>
    </Card>
  );
}
