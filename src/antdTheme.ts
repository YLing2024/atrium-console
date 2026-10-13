import { theme, type ThemeConfig } from 'antd';
import type { Theme } from './theme';

// 设计系统字体栈（与 tokens.css 的 --font-sans 对齐，去掉 antd 默认字体）
const FONT_FAMILY =
  "'Inter Tight', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * 把本仓库设计令牌映射到 antd token：暖纸白 / 墨黑 / 琥珀，直角 0、发丝线、动效 ≤150ms。
 * 只改 antd token 层，不动 CSS 里的令牌定义（check-tokens 的 6 个基准令牌仍是唯一来源）。
 */
export function buildAntdTheme(mode: Theme): ThemeConfig {
  const dark = mode === 'dark';
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    cssVar: true,
    token: {
      wireframe: false,
      colorPrimary: dark ? '#c77c1f' : '#a05b0c',
      colorBgBase: dark ? '#13110f' : '#f7f6f3',
      colorBgLayout: dark ? '#13110f' : '#f7f6f3',
      colorBgContainer: dark ? '#191715' : '#fbfaf8',
      colorText: dark ? '#efeae3' : '#171512',
      colorTextSecondary: dark ? '#a29b92' : '#6f6a63',
      colorTextTertiary: dark ? '#a29b92' : '#6f6a63',
      colorBorder: dark ? 'rgba(239,234,227,0.16)' : 'rgba(23,21,18,0.16)',
      colorBorderSecondary: dark ? 'rgba(239,234,227,0.16)' : 'rgba(23,21,18,0.16)',
      borderRadius: 0,
      borderRadiusLG: 0,
      borderRadiusSM: 0,
      borderRadiusXS: 0,
      fontFamily: FONT_FAMILY,
      fontSize: 14,
      controlHeight: 32,
      motionDurationFast: '0.1s',
      motionDurationMid: '0.15s',
      motionDurationSlow: '0.15s'
    }
  };
}
