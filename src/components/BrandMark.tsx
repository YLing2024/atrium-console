/**
 * 站点品牌标记：四格方块（与管理台的信息密度呼应）。
 *
 * 纯几何图形，跟随文字颜色；右下一格用强调色，作为唯一彩色元素。
 */
export default function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      <rect x="96" y="96" width="144" height="144" rx="24" fill="currentColor" />
      <rect x="272" y="96" width="144" height="144" rx="24" fill="currentColor" opacity="0.55" />
      <rect x="96" y="272" width="144" height="144" rx="24" fill="currentColor" opacity="0.35" />
      <rect x="272" y="272" width="144" height="144" rx="24" fill="#1677ff" />
    </svg>
  );
}
