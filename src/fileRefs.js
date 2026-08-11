/**
 * FILE: @file:<路径> 引用解析（文件附件历史持久化格式）。
 *
 * 发送文件时前端把服务器绝对路径拼进 prompt text：`@file:/abs/path`（多个换行分隔），
 * agent 的文件工具据此读取服务器文件；user 消息 text 按原样落库，resume 时含该引用。
 * 本模块负责：
 *  - 从文本中提取路径（可选引号/反引号包裹，路径支持 / ~/ 盘符开头）；
 *  - 从文本中移除引用，不显示 @file: 字样；
 *  - 代码块 / 行内代码内的 @file: 示例不解析（受保护片段跳过，与 MEDIA 一致）；
 *  - 返回去重后的文件数组（含扩展名），供消息层渲染文件卡片（复用 .msg-file 样式）。
 */

import { findProtectedRanges } from './mediaTags.js';

// @file: 后到行尾/空白/标点的路径；兼容引号包裹（`path` / "path" / 'path'）。
// 标点集与 @image: / MEDIA 标签边界保持一致，避免路径被半角/全角标点截断或吞入相邻文本。
const FILE_REF_RE =
  /([`"'*_]{0,3})@file:\s*(`[^`\n]+?`|"[^"\n]+?"|'[^'\n]+?'|(?:~\/|\/|[A-Za-z]:[\\/])[^\s`"',;:)\]}>、，。；：！？（）「」『』《》〈〉“”‘’·…]+)[`"'*_]{0,3}/gi;

// 归一化路径：剥掉引号/反引号包裹与首尾标点
export function normalizeFileRefPath(raw) {
  let p = String(raw || '').trim();
  if (p.length >= 2 && p[0] === p[p.length - 1] && '`"\' '.includes(p[0])) {
    p = p.slice(1, -1).trim();
  }
  return p.replace(/^[`"']+/, '').replace(/[`"',.;:)}\]]+$/, '');
}

// 提取路径扩展名（无则返回空串，走通用附件图标）
function extOf(path) {
  const m = path.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * 解析文本中的 @file:<路径> 引用。
 * @param {string} text 原始消息文本
 * @returns {{ text: string, files: Array<{path: string, ext: string}> }}
 *          text 为移除引用后的干净文本，files 为按出现顺序去重的文件数组
 *          （无引用时为空数组）
 */
export function parseFileRefs(text) {
  if (!text || !/@file:/i.test(text)) return { text: text || '', files: [] };
  const protectedRanges = findProtectedRanges(text, '@file:');
  const isProtected = (start, end) =>
    protectedRanges.some(([s, e]) => start < e && end > s);
  const found = [];
  let m;
  const re = new RegExp(FILE_REF_RE.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    const path = normalizeFileRefPath(m[2]);
    if (!path) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (isProtected(start, end)) continue;
    found.push({ path, ext: extOf(path), start, end });
  }
  if (!found.length) return { text, files: [] };
  const files = [];
  const seen = new Set();
  let clean = text;
  for (let i = found.length - 1; i >= 0; i--) {
    const { path, ext, start, end } = found[i];
    if (!seen.has(path)) {
      seen.add(path);
      files.unshift({ path, ext });
    }
    clean = clean.slice(0, start) + clean.slice(end);
  }
  return { text: clean, files };
}
