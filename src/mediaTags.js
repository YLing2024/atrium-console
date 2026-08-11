/**
 * MEDIA: 标签解析（仿 Hermes 官方语法）。
 *
 * 官方在回复文本里输出 `MEDIA:<path>` 表示附带图片/文件；微信网关用 extract_media
 * 提取后作为附件推送，而 TUI 网关（WS）不处理该标签，原样保留在 message.complete 的
 * text 里，由前端自行解析展示。本模块负责：
 *  - 提取标签（可选引号/反引号/强调包裹，路径支持 / 与 ~/ 开头）；
 *  - 从文本中移除标签（清洗），只显示普通 markdown；
 *  - 代码块 / 行内代码内的 MEDIA: 示例不解析（受保护片段跳过）。
 */

// 图片扩展名：渲染为 <img>（含 lightbox 点击放大）
const MEDIA_IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'avif', 'tiff'
]);

// 其他文件扩展名：渲染为文件卡片（官方 MEDIA_DELIVERY_EXTS 全集，去掉已归入图片的部分）
const MEDIA_FILE_EXTS = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp',
  'mp3', 'm2a', 'wav', 'ogg', 'opus', 'm4a', 'flac',
  'pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'epub',
  'xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml',
  'kmz', 'kml', 'geojson', 'gpx',
  'pptx', 'ppt', 'odp', 'key',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'apk', 'ipa',
  'html', 'htm'
]);

export const MEDIA_ALL_EXTS = new Set([...MEDIA_IMAGE_EXTS, ...MEDIA_FILE_EXTS]);

// 扩展名正则分支：按长度降序拼接，避免 .tar 先于 .tar.gz 被截断（同官方实现）
const MEDIA_EXT_ALT = Array.from(MEDIA_ALL_EXTS).sort((a, b) => b.length - a.length).join('|');

// 仿官方 MEDIA_TAG_CLEANUP_RE：可选引号/反引号/强调包裹，路径支持 / ~/ 盘符 开头。
// 路径到空白/标点边界，扩展名必须在白名单内；未知扩展名标签原样留在文本里。
const MEDIA_TAG_RE = new RegExp(
  '[`"\'*_]{0,3}MEDIA:\\s*' +
  '(`[^`\\n]+?`|"[^"\\n]+?"|\'[^\'\\n]+?\'|(?:~/|/|[A-Za-z]:[/\\\\])\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:' + MEDIA_EXT_ALT + '))' +
  '(?=[\\s`"\'*_,;:)\\]}\\[]|MEDIA:|\\.(?:\\s|$)|[。，、；：！？（）「」『』《》〈〉“”‘’·…]|$)[`"\'*_]{0,3}\\.?',
  'gi'
);

// 掩码定位 fenced 代码块 + 行内代码的 [start, end) 区间（保持原文本偏移）。
// tag 参数支持 MEDIA:/@file: 等标签复用同一套保护机制。
export function findProtectedRanges(text, tag = 'MEDIA:') {
  const ranges = [];
  const lines = text.split('\n');
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLen = line.length;
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const ch = fence[1][0];
      const min = fence[1].length;
      const closeRe = new RegExp('^\\s*' + ch + '{' + min + ',}');
      let j = i + 1;
      while (j < lines.length && !closeRe.test(lines[j])) j++;
      const last = j >= lines.length ? lines.length - 1 : j;
      let end = pos;
      for (let k = i; k <= last; k++) end += lines[k].length + 1;
      ranges.push([pos, end]);
      for (let k = i; k <= last; k++) pos += lines[k].length + 1;
      i = last;
    } else {
      pos += lineLen + 1;
    }
  }
  // 行内代码：整体为 `` `TAG:path` ``（反引号包裹标签）或 `TAG:` 后的反引号路径引用
  // 不算受保护片段，其余行内代码 span（含 TAG: 示例的更大代码片段）一律保护。
  const tagEsc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pathQuoteRe = new RegExp(tagEsc + '\\s*$');
  const wrappedTagRe = new RegExp('^' + tagEsc, 'i');
  const inlineRe = /`([^`\n]+)`/g;
  let mm;
  while ((mm = inlineRe.exec(text)) !== null) {
    const prefix = text.slice(0, mm.index);
    const inner = mm[1].trim();
    const isPathQuote = pathQuoteRe.test(prefix);
    const isWrappedTag = wrappedTagRe.test(inner);
    if (isPathQuote || isWrappedTag) continue;
    ranges.push([mm.index, mm.index + mm[0].length]);
  }
  return ranges;
}

// 归一化路径：剥掉引号/反引号包裹与首尾标点（同官方 _normalize_media_tag_path）
export function normalizeMediaPath(raw) {
  let p = String(raw || '').trim();
  if (p.length >= 2 && p[0] === p[p.length - 1] && '`"\' '.includes(p[0])) {
    p = p.slice(1, -1).trim();
  }
  return p.replace(/^[`"']+/, '').replace(/[`"',.;:)}\]]+$/, '');
}

/**
 * 提取并清洗 MEDIA 标签。
 * @param {string} text 原始消息文本
 * @returns {{ text: string, media: Array<{path: string, ext: string, type: 'image'|'file'}> }}
 */
export function parseMediaTags(text) {
  if (!text || !/MEDIA:/i.test(text)) return { text: text || '', media: [] };
  const protectedRanges = findProtectedRanges(text);
  const isProtected = (start, end) =>
    protectedRanges.some(([s, e]) => start < e && end > s);
  const found = [];
  let m;
  while ((m = MEDIA_TAG_RE.exec(text)) !== null) {
    const path = normalizeMediaPath(m[1]);
    if (!path) continue;
    const extMatch = path.match(/\.([a-z0-9]+)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    if (!MEDIA_ALL_EXTS.has(ext)) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (isProtected(start, end)) continue;
    found.push({ path, ext, start, end, type: MEDIA_IMAGE_EXTS.has(ext) ? 'image' : 'file' });
  }
  if (!found.length) return { text, media: [] };
  let clean = text;
  for (let i = found.length - 1; i >= 0; i--) {
    clean = clean.slice(0, found[i].start) + clean.slice(found[i].end);
  }
  return { text: clean, media: found.map(({ path, ext, type }) => ({ path, ext, type })) };
}
