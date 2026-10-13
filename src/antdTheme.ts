import { theme, type ThemeConfig } from 'antd';
import type { Theme } from './theme';

// 设计系统字体栈（与 tokens.css 的 --font-sans 对齐，去掉 antd 默认字体）
const FONT_FAMILY =
  "'Inter Tight', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * 把本仓库设计令牌映射到 antd token：暖纸白 / 墨黑 / 琥珀，直角 0、发丝线、动效 ≤150ms。
 * 只改 antd token 层，不动 CSS 里的令牌定义（check-tokens 的 6 个基准令牌仍是唯一来源）。
 *
 * 深色档在默认 antd token 之上补了几处对比度修正（依据 WCAG 相对亮度计算，见下），
 * 浅色档保持原映射不变。
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
      // 深色占位符：antd 默认 25% 白对底约 2.3:1，改用与次要文字同值（约 6.5:1）
      ...(dark ? { colorTextPlaceholder: '#a29b92' } : {}),
      // 深色边框：antd 默认 16% 白对底约 1.55:1，低于非文本 3:1，提到 40%（约 3.4:1）
      colorBorder: dark ? 'rgba(239,234,227,0.4)' : 'rgba(23,21,18,0.16)',
      colorBorderSecondary: dark ? 'rgba(239,234,227,0.4)' : 'rgba(23,21,18,0.16)',
      // 深色错误/链接文字：改用本系统令牌系，保证 AA（错误约 5.0:1，链接约 5.2:1）
      ...(dark ? { colorError: '#f87171', colorLink: '#d98e35' } : {}),
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
    },
    // 菜单选中态（仅深色）：默认选中文字用派生主色 #ac6c1d 落在选中底 #4a3317 上约 2.8:1，
    // 换成更亮的琥珀文字 + 更沉的琥珀底，约 5.4:1。
    ...(dark
      ? {
          components: {
            Menu: {
              itemSelectedColor: '#d98e35',
              itemSelectedBg: 'rgba(199,124,31,0.16)',
              itemActiveBg: 'rgba(199,124,31,0.16)'
            }
          }
        }
      : {})
  };
}
