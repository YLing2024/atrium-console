import { appIconChildren, appIconFallbackText } from '../appIcons';

// name 命中图标表 → 渲染内联 <svg>（单色描边，跟随 currentColor）；
// 未命中（含中文单字、undefined）→ 回退成单个文字，保持原首字标记外观。
export default function AppIcon({
  name,
  fallback,
  size = 20
}: {
  name?: string | null;
  fallback?: string | null;
  size?: number;
}) {
  const children = appIconChildren(name);
  if (children) {
    return (
      <span className="apps-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          // 图标字符串是模块内静态常量，非用户输入。
          dangerouslySetInnerHTML={{ __html: children.join('') }}
        />
      </span>
    );
  }
  return (
    <span className="apps-icon" aria-hidden="true">
      {appIconFallbackText(fallback)}
    </span>
  );
}
