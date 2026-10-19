// 「旧调色板清零」守卫（零依赖）。
//
// 背景：本站设计语言已完全交由 antd 默认 token（cssVar 模式下的 --ant-* 变量），
// 原先那套「暖纸白 / 墨黑 / 琥珀」自建调色板（--bg / --surface / --fg / --muted /
// --faint / --line / --accent* / --danger / --warn / --ok / --ease 等）已全部移除。
// 本脚本替代旧的「与 homepage 基准表逐值比对」，改为守住新的不变量：
//   1. 源码里不得再出现任何对旧令牌的 var(--...) 引用；
//   2. 源码里不得再出现旧调色板的字面色值（hex / rgba）。
// 命中任何一条即打印位置并非 0 退出。
//
// 扫描范围：实际交付的前端产物来源（src/ 与 public/ 下的源码、以及两个 HTML 入口）。
// 不含 node_modules / e2e / 历史文档。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 旧令牌名（含历史别名）。匹配 var(--name)，且 name 后不能再接 [\w-]，
// 以免误伤 --ant-color-* 之类的 antd 变量。
const LEGACY_VARS = new RegExp(
  String.raw`var\(--(?:bg|bg-2|bg-soft|surface|surface-2|fg|ink|text|text-2|muted|faint|accent|accent-ink|accent-soft|accent-border|danger|warn|ok|border|line|line-soft|hairline|ease)(?![\w-])`,
  'g'
);

// 旧调色板字面色值（暖纸白 / 墨黑 / 琥珀 / 语义色，深浅两套）。
const LEGACY_HEX = new RegExp(
  String.raw`#(?:f7f6f3|fbfaf8|efece6|171512|6f6a63|9b958d|a05b0c|7c4508|dc2626|d97706|15803d|13110f|191715|211e1b|efeae3|a29b92|a29b91|746e66|c77c1f|d98e35|f87171|fbbf24|4ade80)\b`,
  'gi'
);

// 旧调色板的 rgba 形式（发丝线 / 琥珀软色等）。
const LEGACY_RGBA =
  /rgba?\(\s*(?:23\s*,\s*21\s*,\s*18|239\s*,\s*234\s*,\s*227|160\s*,\s*91\s*,\s*12|199\s*,\s*124\s*,\s*31)/gi;

const SCAN_DIRS = ['src', 'public'];
const SCAN_FILES = ['index.html'];
const EXTS = new Set(['.css', '.ts', '.tsx', '.html', '.webmanifest']);

function collect(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collect(full, out);
    } else if (EXTS.has(entry.slice(entry.lastIndexOf('.')))) {
      out.push(full);
    }
  }
}

function findMatches(file) {
  const text = readFileSync(file, 'utf8');
  const hits = [];
  const push = (label, re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push(`${relative(ROOT, file)}:${line}  ${label} ${m[0]}`);
    }
  };
  push('旧令牌引用', LEGACY_VARS);
  push('旧调色板色值', LEGACY_HEX);
  push('旧调色板色值', LEGACY_RGBA);
  return hits;
}

function main() {
  const files = [];
  for (const d of SCAN_DIRS) collect(join(ROOT, d), files);
  for (const f of SCAN_FILES) files.push(join(ROOT, f));

  const problems = files.flatMap(findMatches);
  if (problems.length) {
    console.error('发现旧调色板残留（应全部替换为 antd 默认）：');
    for (const p of problems) console.error('  ' + p);
    console.error(`\n共 ${problems.length} 处，旧调色板校验失败。`);
    process.exit(1);
  }

  console.log(
    `旧调色板校验通过：扫描 ${files.length} 个文件，无旧令牌引用 / 无旧调色板字面色值。`
  );
}

main();
