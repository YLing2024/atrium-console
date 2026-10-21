import { useEffect, useRef } from 'react';
import { theme } from 'antd';
import * as echarts from 'echarts/core';
import type { ComposeOption, EChartsType } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { LineSeriesOption } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent
} from 'echarts/components';
import type {
  GridComponentOption,
  TooltipComponentOption,
  DataZoomComponentOption,
  LegendComponentOption
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { subscribeTheme } from '../theme';

// 按需注册：只用折线 + 网格 / 提示 / 缩放 / 图例 + Canvas 渲染器，不引入整包。
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  CanvasRenderer
]);

/** 本封装只组合实际用到的组件类型，避免依赖整包类型 */
export type EChartsOption = ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | DataZoomComponentOption
  | LegendComponentOption
>;

export interface ChartProps {
  option: EChartsOption;
  height?: number | string;
  className?: string;
  loading?: boolean;
  onReady?: (chart: EChartsType) => void;
  /**
   * 同一 group 的多个图表会被 echarts.connect 联动：
   * 缩放/拖选/悬停十字线在全组同步。用于「多图共享时间轴」。
   */
  group?: string;
}

const LOADING_TEXT = '数据采集中…';

/**
 * ECharts 唯一入口：负责实例生命周期（init / setOption / resize / dispose）与主题重建。
 * 颜色一律由调用方从 antd 主题 token 注入 option，这里不写死任何颜色。
 */
export default function Chart({
  option,
  height = 200,
  className,
  loading,
  onReady,
  group
}: ChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const optionRef = useRef(option);
  const loadingRef = useRef(Boolean(loading));
  const onReadyRef = useRef(onReady);
  const groupRef = useRef(group);
  groupRef.current = group;
  const { token } = theme.useToken();
  const tokenRef = useRef(token);
  optionRef.current = option;
  loadingRef.current = Boolean(loading);
  onReadyRef.current = onReady;
  tokenRef.current = token;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    let chart: EChartsType | null = null;

    function applyLoading() {
      if (!chart) return;
      if (loadingRef.current) {
        chart.showLoading('default', {
          text: LOADING_TEXT,
          color: tokenRef.current.colorPrimary,
          textColor: tokenRef.current.colorText,
          maskColor: tokenRef.current.colorBgContainer
        });
      } else {
        chart.hideLoading();
      }
    }

    // 容器不可见（display:none）时尺寸为 0，延迟到 ResizeObserver 报出尺寸后再 init
    function ensure(target: HTMLDivElement) {
      if (chart || !target.clientWidth || !target.clientHeight) return;
      chart = echarts.init(target);
      if (groupRef.current) {
        chart.group = groupRef.current;
        echarts.connect(groupRef.current);
      }
      chartRef.current = chart;
      chart.setOption(optionRef.current, { notMerge: true });
      applyLoading();
      onReadyRef.current?.(chart);
    }

    ensure(el);

    const ro = new ResizeObserver(() => {
      if (!chart) {
        ensure(el);
        return;
      }
      if (!el.clientWidth) return;
      chart.resize();
    });
    ro.observe(el);

    // 深浅色切换：重建实例（option 的颜色来自 antd token，消费方会随主题重渲染）
    const unsubscribe = subscribeTheme(() => {
      if (chart) {
        chart.dispose();
        chart = null;
        chartRef.current = null;
      }
      ensure(el);
    });

    return () => {
      unsubscribe();
      ro.disconnect();
      if (chart) {
        chart.dispose();
        chart = null;
      }
      chartRef.current = null;
    };
  }, []);

  // 数据 / 配置更新：整体替换，避免残留旧序列
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (loading) {
      chart.showLoading('default', {
        text: LOADING_TEXT,
        color: token.colorPrimary,
        textColor: token.colorText,
        maskColor: token.colorBgContainer
      });
    } else {
      chart.hideLoading();
    }
  }, [loading, token.colorPrimary, token.colorText, token.colorBgContainer]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: '100%', height: typeof height === 'number' ? `${height}px` : height }}
    />
  );
}
