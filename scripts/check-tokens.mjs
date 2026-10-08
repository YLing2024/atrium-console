// 设计令牌一致性校验（零依赖）。
// 从本仓库 src/styles/tokens.css 解析核心令牌（深浅两套），与脚本内的基准值表比对；
// 任一不一致，或同一色在深浅两套/多个来源之间自相矛盾，即打印差异并非 0 退出。
// 用途：防止同一组颜色在多个仓库里悄悄漂移。不引入共享包、不上 monorepo。
//
// 与 homepage 版差异只有「本地解析配置」一处，基准值表逐字照搬（跨项目防漂移的契约）：
//   - 令牌文件名：src/index.css → src/styles/tokens.css
//   - 高亮发丝线令牌在本仓库叫 --border（homepage 叫 --line），取值相同，见 ALIASES
//   - 深浅两套在本仓库用 html[data-theme='light'|'dark'] 显式覆盖，暗色另一来源是媒体查询
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CSS_PATH = fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url))

// 核心令牌 —— 基准值取自 homepage 现行 index.css（改动令牌须同步改这里，否则校验失败）
const TOKENS = ['--bg', '--surface', '--fg', '--muted', '--line', '--accent']

const BASELINE = {
  light: {
    '--bg': '#f7f6f3',
    '--surface': '#fbfaf8',
    '--fg': '#171512',
    '--muted': '#6f6a63',
    '--line': 'rgba(23,21,18,0.16)',
    '--accent': '#a05b0c',
  },
  dark: {
    '--bg': '#13110f',
    '--surface': '#191715',
    '--fg': '#efeae3',
    '--muted': '#a29b92',
    '--line': 'rgba(239,234,227,0.16)',
    '--accent': '#c77c1f',
  },
}

// 本仓库的令牌命名别名：基准名 → 本仓库可能使用的名字（本仓库把发丝线叫 --border）
const ALIASES = {
  '--line': ['--border'],
}

const SELECTORS = {
  light: /:root\s*\{/,
  lightAttr: /html\[data-theme=['"]light['"]\]\s*\{/,
  // 暗色来源一：系统偏好媒体查询（其内部才是 :root 声明块）
  darkMedia: /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/,
  darkAttr: /html\[data-theme=['"]dark['"]\]\s*\{/,
}

// 取出 selector 对应的声明块（花括号配平；先剥注释避免块内 `{}` 干扰）
function findBlock(css, selectorRe) {
  const match = selectorRe.exec(css)
  if (!match) return null
  // 选择器正则自带结尾 `{`，从匹配串内最后一个 `{` 起算，兼容媒体查询嵌套
  const offset = match[0].lastIndexOf('{')
  const start = offset >= 0 ? match.index + offset : css.indexOf('{', match.index)
  return readBlock(css, start)
}

// 从开括号位置读出配平后的块内容
function readBlock(css, openIdx) {
  if (openIdx < 0) return null
  let depth = 0
  for (let i = openIdx; i < css.length; i += 1) {
    const ch = css[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return css.slice(openIdx + 1, i)
    }
  }
  return null
}

// 媒体查询外包块 → 其内部 :root 声明块
function findMediaRoot(css, mediaRe) {
  const match = mediaRe.exec(css)
  if (!match) return null
  const outer = readBlock(css, match.index + match[0].length - 1)
  return outer ? findBlock(outer, /:root\s*\{/) : null
}

// 从声明块解析需要的令牌；值做归一化（去空白、转小写）后比较。
// 基准名可经 ALIASES 命中本仓库的本地名（如 --line ↔ --border）。
function parseTokens(block) {
  const out = {}
  if (!block) return out
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(block)) !== null) {
    const name = m[1]
    const value = m[2].trim().replace(/\s+/g, '').toLowerCase()
    if (TOKENS.includes(name)) {
      if (!(name in out)) out[name] = value
      continue
    }
    for (const canonical of TOKENS) {
      const aliases = ALIASES[canonical] || []
      if (aliases.includes(name) && !(canonical in out)) out[canonical] = value
    }
  }
  return out
}

function diffSet(actual, expected) {
  const problems = []
  for (const name of TOKENS) {
    const a = actual[name] ?? null
    const e = expected[name]
    if (a !== e) problems.push({ name, expected: e, actual: a })
  }
  return problems
}

function describe(problems) {
  return problems
    .map(({ name, expected, actual }) => `  ${name}: 期望 ${expected} / 实际 ${actual ?? '(缺失)'}`)
    .join('\n')
}

// 与基准比对；returns true 表示发现问题（已打印）
function compareToBaseline(label, actual, baseline) {
  if (!Object.keys(actual).length) return false
  const diff = diffSet(actual, baseline)
  if (!diff.length) return false
  console.error(`${label}令牌与基准不一致：`)
  console.error(describe(diff))
  return true
}

function main() {
  let css
  try {
    css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  } catch (err) {
    console.error(`读取令牌文件失败：${CSS_PATH}\n${err.message}`)
    process.exit(1)
  }

  const light = parseTokens(findBlock(css, SELECTORS.light))
  const lightAttr = parseTokens(findBlock(css, SELECTORS.lightAttr))
  const darkMedia = parseTokens(findMediaRoot(css, SELECTORS.darkMedia))
  const darkAttr = parseTokens(findBlock(css, SELECTORS.darkAttr))

  let failed = false

  if (!Object.keys(light).length) {
    console.error('未在 :root 中找到任何核心令牌')
    failed = true
  }
  if (!Object.keys(darkMedia).length && !Object.keys(darkAttr).length) {
    console.error('未找到暗色令牌（@media 或 data-theme 均缺失）')
    failed = true
  }

  // 与基准比对（每个存在的来源都要一致）
  failed = compareToBaseline('浅色 :root ', light, BASELINE.light) || failed
  failed = compareToBaseline('浅色 [data-theme="light"] ', lightAttr, BASELINE.light) || failed
  failed = compareToBaseline('@media 暗色 ', darkMedia, BASELINE.dark) || failed
  failed = compareToBaseline('[data-theme="dark"] ', darkAttr, BASELINE.dark) || failed

  // 同一档位的多个来源彼此也必须一致（任一来源单独漂移即失败）
  const crossChecks = [
    { label: '浅色两来源（:root 与 data-theme="light"）', a: light, b: lightAttr },
    { label: '暗色两来源（@media 与 data-theme="dark"）', a: darkMedia, b: darkAttr },
  ]
  for (const { label, a, b } of crossChecks) {
    if (!Object.keys(a).length || !Object.keys(b).length) continue
    const crossDiff = TOKENS.filter((name) => a[name] !== b[name]).map((name) => ({
      name,
      expected: a[name] ?? '(缺失)',
      actual: b[name] ?? '(缺失)',
    }))
    if (crossDiff.length) {
      console.error(`${label}不一致：`)
      console.error(describe(crossDiff))
      failed = true
    }
  }

  if (failed) {
    console.error('\n设计令牌校验失败。')
    process.exit(1)
  }

  console.log(`设计令牌校验通过：${TOKENS.length} 个核心令牌 × 深浅两套来源，与基准一致。`)
}

main()
