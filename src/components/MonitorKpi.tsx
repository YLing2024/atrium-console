/**
 * MonitorKpi —— 监控页顶部 KPI 卡与 40×28 迷你趋势线（sparkline）。
 *
 * 设计要点：
 * - 卡片等高、无阴影、圆角 8，内边距 16；数字统一 `tabular-nums`，刷新时不跳动；
 * - 迷你线只表达形状：无坐标轴 / 网格 / 标签，线宽 1.5，下方 8% 透明度渐变填充；
 * - 常态用主色，越过阈值才切 warning / error；无数据时主数字显示破折号，不显示 0。
 */
import { useId, type ReactNode } from 'react';
import { Card, Tooltip, Typography, theme } from 'antd';
import { buildSparkGeometry, coreTone, type ValueTone } from '../monitor';
import type { CoreUsage } from '../api';

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

/** 每核迷你条的可选核数上限；后端 per_core 本就截断到 8。 */
const MAX_CORE_BARS = 8;

export interface CoreBarsProps {
  /** 后端 `cpu.per_core`（id + usage_percent）；缺失时渲染等宽占位条 */
  cores?: ReadonlyArray<CoreUsage | null | undefined> | null;
}

/**
 * CPU 卡里的每核迷你条：8 条竖条，高度即使用率，颜色按 70/85 分档。
 *
 * 用竖条而不是再画一张图：CPU 卡只有一行高度，竖条能在不挤压数字的前提下
 * 表达「哪一核忙」。数值同时写进 `aria-label` 与 Tooltip，颜色不是唯一语义。
 * @param props 见 {@link CoreBarsProps}
 */
export function CoreBars({ cores }: CoreBarsProps) {
  const { token } = theme.useToken();
  const list = Array.isArray(cores) ? cores.slice(0, MAX_CORE_BARS) : [];
  if (list.length === 0) {
    return <div className="monitor-core-bars monitor-core-bars--empty" aria-hidden="true" />;
  }
  return (
    <div className="monitor-core-bars" role="group" aria-label="每核使用率">
      {list.map((core, index) => {
        const id = core?.id ?? index;
        const value = Number(core?.usage_percent);
        const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
        const tone = coreTone(percent);
        const color =
          tone === 'error'
            ? token.colorError
            : tone === 'warning'
              ? token.colorWarning
              : token.colorPrimary;
        const label = percent == null ? `核心 ${id}：无数据` : `核心 ${id}：${percent.toFixed(1)}%`;
        return (
          <Tooltip key={String(id)} title={label}>
            <span
              className="monitor-core-bar-track"
              role="img"
              aria-label={label}
              tabIndex={0}
            >
              <i
                className="monitor-core-bar"
                style={{
                  height: percent == null ? '6%' : `${Math.max(6, percent)}%`,
                  background: percent == null ? token.colorFillSecondary : color
                }}
              />
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

export interface KpiCardProps {
  /** 指标名（12px 次级色） */
  label: string;
  /** 主数字；无数据时传 `—` */
  value: string;
  /** 副行说明（12px 次级色） */
  detail: ReactNode;
  /** 可选进度条（0–100）；不传则不渲染 */
  progress?: number | null;
  /** 副行下方的补充内容（如每核迷你条、内存细项） */
  children?: ReactNode;
  /** 迷你线采样值 */
  spark: ReadonlyArray<number | null | undefined>;
  /** 语义档位，默认 normal */
  tone?: KpiTone;
  /** 点击整卡的动作（如联动下方进程表排序）；不传则纯展示 */
  onClick?: () => void;
}

/**
 * 单张 KPI 卡。
 * @param props 见 {@link KpiCardProps}
 */
export function KpiCard({ label, value, detail, progress, children, spark, tone = 'normal', onClick }: KpiCardProps) {
  const { token } = theme.useToken();
  const color =
    tone === 'error'
      ? token.colorError
      : tone === 'warning'
        ? token.colorWarning
        : token.colorPrimary;
  const progressValue = Number(progress);
  const hasProgress = progress != null && Number.isFinite(progressValue);
  return (
    <Card
      className={onClick ? 'monitor-kpi-card monitor-kpi-card--clickable' : 'monitor-kpi-card'}
      style={{ height: '100%', cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
      hoverable={Boolean(onClick)}
    >
      <div className="monitor-kpi-top">
        <Typography.Text type="secondary" className="monitor-kpi-label">
          {label}
        </Typography.Text>
        <Sparkline values={spark} color={color} />
      </div>
      <div className="monitor-kpi-value">{value}</div>
      {hasProgress && (
        <div
          className="monitor-kpi-progress"
          role="progressbar"
          aria-label={`${label}使用率`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressValue * 10) / 10}
          aria-valuetext={`${progressValue.toFixed(1)}%`}
        >
          <span
            className="monitor-kpi-progress-fill"
            style={{ width: `${Math.max(0, Math.min(100, progressValue))}%`, background: color }}
          />
        </div>
      )}
      <div className="monitor-kpi-detail">{detail}</div>
      {children}
    </Card>
  );
}
