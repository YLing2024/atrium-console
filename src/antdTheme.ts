import { theme, type ThemeConfig } from 'antd';
import type { Theme } from './theme';

/**
 * antd 默认设计语言：只按浅色 / 深色选择算法，其余全部交给 antd 默认 token
 * （默认主色、圆角、字体栈、动效），不做任何自定义映射。
 * cssVar 开启 CSS 变量模式，减少运行时样式抖动。
 */
export function buildAntdTheme(mode: Theme): ThemeConfig {
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    cssVar: true
  };
}
