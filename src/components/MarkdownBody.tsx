import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Markdown 正文渲染（通知展开区等只读场景）。
 * 正文可能来自外部网页，一律不可信：先 DOMPurify.sanitize 再 dangerouslySetInnerHTML。
 * 用法同 BlogAdmin 预览：DOMPurify.sanitize(marked.parse(text))；零新增依赖。
 */
export default function MarkdownBody({
  text,
  className = ''
}: {
  text?: string | null;
  className?: string;
}) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text || '') as string), [text]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
