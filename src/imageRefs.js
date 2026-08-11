/**
 * IMAGE: @image:<路径> 引用解析（Hermes 历史持久化格式）。
 *
 * 带图 user 消息落库为文本引用 `@image:/abs/path`（_build_persist_message_with_image_refs），
 * session.resume 返回的消息 text 字段内含该引用，且没有独立的 images 字段。
 * 本模块负责：
 *  - 从文本中提取路径（可选引号/反引号包裹，路径支持 / ~/ 盘符开头）；
 *  - 从文本中移除引用，不显示 @image: 字样；
 *  - 返回去重后的路径数组，供消息 images 字段走现有 .msg-imgs / lightbox 渲染。
 */

// @image: 后到行尾/空白/标点的路径；兼容引号包裹（`path` / "path" / 'path'）。
// 标点集与 MEDIA 标签边界保持一致，避免路径被半角/全角标点截断或吞入相邻文本。
const IMAGE_REF_RE =
  /([`"'*_]{0,3})@image:\s*(`[^`\n]+?`|"[^"\n]+?"|'[^'\n]+?'|(?:~\/|\/|[A-Za-z]:[\\/])[^\s`"',;:)\]}>、，。；：！？（）「」『』《》〈〉“”‘’·…]+)[`"'*_]{0,3}/gi;

// 归一化路径：剥掉引号/反引号包裹与首尾标点
export function normalizeImageRefPath(raw) {
  let p = String(raw || '').trim();
  if (p.length >= 2 && p[0] === p[p.length - 1] && '`"\' '.includes(p[0])) {
    p = p.slice(1, -1).trim();
  }
  return p.replace(/^[`"']+/, '').replace(/[`"',.;:)}\]]+$/, '');
}

/**
 * 解析文本中的 @image:<路径> 引用。
 * @param {string} text 原始消息文本
 * @returns {{ text: string, images: string[] }} text 为移除引用后的干净文本，
 *          images 为按出现顺序去重的路径数组（无引用时为空数组）
 */
export function parseImageRefs(text) {
  if (!text || !/@image:/i.test(text)) return { text: text || '', images: [] };
  const found = [];
  let m;
  const re = new RegExp(IMAGE_REF_RE.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    const path = normalizeImageRefPath(m[2]);
    if (path) found.push({ path, start: m.index, end: m.index + m[0].length });
  }
  if (!found.length) return { text, images: [] };
  const images = [];
  const seen = new Set();
  let clean = text;
  for (let i = found.length - 1; i >= 0; i--) {
    const { path, start, end } = found[i];
    if (!seen.has(path)) {
      seen.add(path);
      images.unshift(path);
    }
    clean = clean.slice(0, start) + clean.slice(end);
  }
  return { text: clean, images };
}
