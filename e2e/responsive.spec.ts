/**
 * 移动端响应式自测（需求书 docs/REQUIREMENTS-responsive-mobile.md §3）。
 *
 * 运行：
 *   # 先起开发服务器（本仓库约定端口 5173）
 *   npm run dev -- --host 127.0.0.1 --port 5173
 *   # 再跑本断言（沿用 e2e 既有的独立脚本方式，零新增依赖）
 *   cd e2e && node responsive.spec.ts
 *
 * 后端不在场：/api/**、/_auth/me 全部用 fixture 桩掉（与 apps-check.cjs / sidebar-check.cjs 同法）。
 * 在 390×844 与 768×1024 两个视口逐页断言主页面：
 *   1) 无文档级横向溢出（documentElement.scrollWidth <= clientWidth + 1）；
 *   2) 每个可见表格：要么 table.width <= viewport，要么存在可横滑祖先，禁止被裁；
 *   3) 可见交互元素命中区：主要操作 ≥40px、次要图标（白名单）≥32px；
 *   3') 表单控件（input/select/textarea/日期/数字输入/勾选框）命中区 ≥44px，
 *       且其字号 ≥16px（需求书 §5，防 iOS 聚焦缩放）；
 *   4) 可见文本字号 ≥12px；
 *   5) 关键页面元素出现，且无 pageerror / 控制台错误。
 * 断言失败会打印 页面名 + 元素文本 + 实际尺寸，便于定位。
 *
 * 说明：antd 表格在 sticky + 固定列下会额外渲染一个与 body 同步横滑的「表头克隆」，
 * 它的祖先 .ant-table-header 自带 overflow:hidden，属于正常结构，不是被裁；
 * 因此第 2 条只针对表格的滚动内容表（.ant-table-body / .ant-table-content 内的 table）判定。
 */
const { chromium } = require('playwright');

const BASE = process.env.RESPONSIVE_BASE || 'http://127.0.0.1:5173/';
const now = Date.now();

// ------------------------------------------------------------------ fixtures
const FIX = {
  sessions: {
    sessions: [
      {
        id: 's1',
        deviceName: 'MacBook Pro 16 (开发机，超长设备名)',
        isCurrent: true,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
        ip: '192.0.2.23',
        isLocal: true,
        createdAt: now - 3600000,
        lastSeenAt: now - 60000,
        expiresAt: (now + 86400000) / 1000
      },
      {
        id: 's2',
        deviceName: 'iPhone',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
        ip: '198.51.100.5',
        location: '局域网',
        createdAt: now - 7200000,
        lastSeenAt: now - 120000,
        expiresAt: (now + 86400000) / 1000
      }
    ]
  },
  tokens: {
    tokens: [
      {
        id: 't1',
        name: '行情脚本令牌-超长名称',
        note: '给外部脚本用，读写通知与系统信息',
        canWrite: true,
        createdAt: now - 86400000,
        expiresAt: (now + 2592000000) / 1000,
        lastUsedAt: now - 500000
      },
      { id: 't2', name: 'home-assistant', note: '家庭自动化只读', canWrite: false, createdAt: now - 172800000, expiresAt: (now + 2592000000) / 1000 }
    ]
  },
  files: {
    path: '',
    parent: '',
    entries: [
      { name: 'backup-2026-10-17-full-archive-with-a-very-long-name.tar.gz', type: 'file', size: 734003200, mtime: now },
      { name: 'blog-gallery-photos-of-the-trip-2026', type: 'dir', size: 0, mtime: now - 100000 },
      { name: 'davbox', type: 'dir', size: 0, mtime: now - 200000 }
    ]
  },
  blog: {
    list: [
      {
        id: 1,
        title: '一篇标题很长很长的文章用于验证博客列表在窄屏下能否横向滑动不被裁切',
        subtitle: '副标题',
        slug: 'a-very-long-slug-here',
        public_id: '1234567890123456789',
        tags: ['标签一', '标签二'],
        published: true,
        collection: { id: 1, name: '合集一' },
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z'
      }
    ]
  },
  collections: {
    list: [
      { id: 1, name: '一个很长很长的合集名称用于测试表格宽度', slug: 'collection-one', public_id: '9876543210987654321', description: '说明', post_count: 12 }
    ]
  },
  versions: {
    list: [
      { name: 'some-very-long-software-package-name-here', category: '命令行工具', version: '1.2.3-alpha.20261017+build.9999', ok: true },
      { name: 'node', category: '运行时', version: '24.0.0', ok: true }
    ]
  },
  services: {
    services: [{ pid: 100, name: 'caddy', status: 'running' }],
    processes: [
      { name: 'a-very-long-process-name-that-keeps-going-and-going', pid: 100, ppid: 1, mem_mb: 12.3, cpu: 0.5, subtree_mem_mb: 40, subtree_cpu: 1.2, subtree_count: 0, thread_count: 8 },
      { name: 'nginx', pid: 200, ppid: 1, mem_mb: 8.1, cpu: 0.1, subtree_mem_mb: 8.1, subtree_cpu: 0.1, subtree_count: 0, thread_count: 2 }
    ],
    count: 2,
    total_mem_mb: 20.4,
    total_cpu: 0.6,
    total_threads: 10
  },
  system: {
    cpu: { usage_percent: 12.5, per_core: [10, 20], cores: 8, model: 'AMD Ryzen 9 5950X', loadavg: [0.5, 0.4, 0.3] },
    memory: { total: 34359738368, used: 12345678901, available: 20000000000, percent: 36 },
    disk: null,
    disks: [{ mount: '/', device: '/dev/nvme0n1p2', total: 500107862016, used: 200000000000, percent: 40 }],
    network: { rx_bytes: 1000, tx_bytes: 2000, rx_speed: 100, tx_speed: 200 },
    uptime: 100000,
    os: 'Linux',
    hostname: 'host'
  },
  apps: {
    generatedAt: new Date().toISOString(),
    cached: false,
    notice: null,
    categories: [{ id: 'core', name: '核心' }],
    apps: [{ id: 'a1', name: '主页', category: 'core', status: 'up', icon: 'home', port: 443, latencyMs: 12, url: 'https://home.example.com' }],
    discovered: []
  },
  notifications: { items: [], unread: 0, total: 0 },
  stats: { total: 0, unread: 0, byLevel: {} },
  types: { types: [] }
};

// 单帧 SSE 快照：让系统页拿到真实数据（否则 !data 只渲染错误行）
const SYSTEM_STREAM =
  'event: snapshot\n' +
  'data: ' +
  JSON.stringify({ system: FIX.system, services: FIX.services, history: [] }) +
  '\n\n';

function dispatch(route) {
  const u = route.request().url();
  const J = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.includes('/_auth/me')) return J({ sub: 'e2e', name: 'e2e', app: 'admin' });
  if (u.includes('/api/admin/auth-mode')) return J({ authMode: 'sso' });
  if (u.includes('/api/admin/system/stream')) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: SYSTEM_STREAM });
  }
  if (u.includes('/api/admin/sessions')) return J(FIX.sessions);
  if (u.includes('/api/admin/api-tokens')) return J(FIX.tokens);
  if (u.includes('/api/admin/files/shares')) return J({ shares: [] });
  if (u.includes('/api/admin/files')) return J(FIX.files);
  if (u.includes('/api/admin/versions')) return J(FIX.versions);
  if (u.includes('/api/admin/services')) return J(FIX.services);
  if (u.includes('/api/admin/system/history')) return J([]);
  if (u.includes('/api/admin/system/metrics')) return J({ points: [] });
  if (u.includes('/api/admin/system')) return J(FIX.system);
  if (u.includes('/api/admin/apps')) return J(FIX.apps);
  if (u.includes('/api/blog/admin/posts')) return J(FIX.blog);
  if (u.includes('/api/blog/admin/collections')) return J(FIX.collections);
  if (u.includes('/api/admin/notifications/stats')) return J(FIX.stats);
  if (u.includes('/api/admin/notifications/types')) return J(FIX.types);
  if (u.includes('/api/admin/notifications')) return J(FIX.notifications);
  if (u.includes('/api/admin/tools/bitwarden/status')) {
    return J({ configured: true, unlocked: false, updatedAt: null, expiresInSeconds: null });
  }
  if (u.includes('/api/admin/tools')) {
    return J([{ id: 'bitwarden', name: 'Bitwarden 解锁', configured: true, unlocked: false, expiresAt: null }]);
  }
  if (u.includes('/api/')) return J({});
  if (u.includes('/term/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>term</body></html>' });
  return route.continue();
}

// 主页面 + 关键元素（文本或选择器）；路径即地址栏，直达 / 刷新都应落对页面
const TABS = [
  { id: 'system', path: '/system', label: '系统', text: ['系统监控'] },
  { id: 'blog', path: '/blog', label: '博客', text: ['博客管理'] },
  { id: 'manage', path: '/manage', label: '管理', text: ['设备管理'] },
  { id: 'sshkeys', path: '/ssh', label: 'SSH 公钥', text: ['SSH 公钥'] },
  { id: 'terminal', path: '/terminal', label: '终端', selector: '.term-gate' },
  { id: 'hermes', path: '/hermes', label: 'Hermes', text: ['HERMES'] },
  { id: 'db', path: '/database', label: '数据库', selector: '.db-bar' },
  { id: 'tools', path: '/tools', label: '工具', selector: '.tool-nav-item' },
  { id: 'tool-bitwarden', path: '/tools/bitwarden', label: 'Bitwarden 解锁', selector: '.tool-page' }
];

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 }
];

// 「次要」交互元素白名单：命中门槛 32px，其余可见交互元素按主要操作 40px 判定。
// 开关属于紧凑型控件，采用 32px 档（窄屏下已由响应式样式撑到 ≥32px）。
// 复选框不再列在此处：表单控件（含勾选框命中区）统一由 FORM_CONTROL_SELECTOR 按 ≥44px 判定。
const SECONDARY_SELECTOR = [
  '.ant-btn-icon-only',
  '.dev-rename-btn',
  '.ant-table-row-expand-icon',
  '.ant-breadcrumb a',
  'a.ant-typography',
  '.ant-table-cell a',
  '.link-btn',
  '.ant-switch'
].join(',');

// 表单控件（需求书 §5）：命中区 ≥44px，不再沿用次要 32px 阈值。
// 命中区取控件本身或最外层包装（affix 包装内的 input 会因嵌套被跳过）。
const FORM_CONTROL_SELECTOR = [
  'input.ant-input',
  'textarea.ant-input',
  '.ant-input-affix-wrapper',
  '.ant-input-number',
  '.ant-picker',
  '.ant-select-single .ant-select-selector',
  '.ant-select-multiple .ant-select-selector',
  '.ant-checkbox'
].join(',');

// 表单控件内承载文本 / 输入的节点：字号必须 ≥16px。
const FORM_TEXT_SELECTOR = [
  'input.ant-input',
  'textarea.ant-input',
  '.ant-input-number-input',
  '.ant-picker-input > input',
  '.ant-select .ant-select-selection-item',
  '.ant-select .ant-select-selection-placeholder',
  '.ant-select .ant-select-selection-search-input'
].join(',');

// ------------------------------------------------------------------ helpers
let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  ok  - ' + msg);
  } else {
    failures += 1;
    console.log('  FAIL- ' + msg);
  }
}

function checkViewport(page, tab) {
  // 1) 文档级横向溢出
  // 2) 表格：装得下 or 可横滑
  // 3) 触摸目标
  // 4) 字号
  return page.evaluate(
    ({ secondarySelector, formControlSelector, formTextSelector, tabLabel }) => {
      const problems = { overflow: null, tables: [], targets: [], formControls: [], formFonts: [], fonts: [] };
      const de = document.documentElement;
      const vw = window.innerWidth;
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      if (de.scrollWidth > de.clientWidth + 1) {
        problems.overflow = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
      }

      // 2) 表格
      for (const w of document.querySelectorAll('.ant-table-wrapper')) {
        if (!visible(w)) continue;
        const table =
          w.querySelector('.ant-table-body table, .ant-table-content table') || w.querySelector('table');
        if (!table) continue;
        const r = table.getBoundingClientRect();
        if (r.right <= vw + 1) continue; // 装得下
        // 找可横滑祖先
        let scroller = null;
        for (let p = table.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) {
            scroller = (p.className || p.tagName).toString();
            break;
          }
        }
        if (!scroller) {
          problems.tables.push({ label: tabLabel, width: Math.round(r.width), right: Math.round(r.right), vw });
        }
      }

      // 3) 触摸目标
      for (const el of document.querySelectorAll('button, a, [role=button], .ant-switch')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        const min = el.matches(secondarySelector) ? 32 : 40;
        if (r.width < min || r.height < min) {
          problems.targets.push({
            label: tabLabel,
            text: (el.textContent || '').trim().slice(0, 16) || '<图标>',
            cls: (el.className || '').toString().split(' ')[0],
            w: Math.round(r.width),
            h: Math.round(r.height),
            min
          });
        }
      }

      // 3') 表单控件命中区 ≥44px（测量最外层控件，跳过嵌套的包装内 input）
      for (const el of document.querySelectorAll(formControlSelector)) {
        if (!visible(el)) continue;
        if (el.parentElement && el.parentElement.closest(formControlSelector)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) {
          problems.formControls.push({
            label: tabLabel,
            cls: (el.className || '').toString().split(' ')[0],
            w: Math.round(r.width),
            h: Math.round(r.height)
          });
        }
      }

      // 3'') 表单控件字号 ≥16px
      const seenFormFonts = new Set();
      for (const el of document.querySelectorAll(formTextSelector)) {
        if (!visible(el)) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs >= 16) continue;
        const key = el.tagName + '|' + fs.toFixed(1);
        if (seenFormFonts.has(key)) continue;
        seenFormFonts.add(key);
        problems.formFonts.push({
          label: tabLabel,
          tag: el.tagName,
          cls: (el.className || '').toString().split(' ')[0],
          fs
        });
      }

      // 4) 字号
      const seen = new Set();
      for (const el of document.querySelectorAll('*')) {
        if (!visible(el)) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs >= 12) continue;
        const key = el.tagName + '|' + fs.toFixed(1) + '|' + (el.className || '').toString();
        if (seen.has(key)) continue;
        seen.add(key);
        problems.fonts.push({ label: tabLabel, tag: el.tagName, cls: (el.className || '').toString().split(' ')[0], fs, text: (el.textContent || '').trim().slice(0, 14) });
      }
      return problems;
    },
    {
      secondarySelector: SECONDARY_SELECTOR,
      formControlSelector: FORM_CONTROL_SELECTOR,
      formTextSelector: FORM_TEXT_SELECTOR,
      tabLabel: tab.label
    }
  );
}

async function runViewport(browser, vp) {
  console.log(`\n========== viewport ${vp.width}x${vp.height} ==========`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });
  await ctx.addCookies([
    { name: '__Host-admin_session', value: 'e2e-fake', domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
  ]);
  await ctx.route('**/*', dispatch);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sidenav, .nav-toggle', { timeout: 15000 });

  for (const tab of TABS) {
    console.log(`\n--- ${tab.label} (${tab.id}) ---`);
    await page.goto(new URL(tab.path, BASE).href, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sidenav, .nav-toggle', { timeout: 15000 });
    check(
      new URL(page.url()).pathname === tab.path,
      `[${tab.label}] 直达 ${tab.path} 未被重定向`
    );
    if (tab.selector) {
      await page.waitForSelector(tab.selector, { timeout: 10000 });
    }
    if (tab.id === 'tools') {
      const passwordInputs = await page.locator('input[type=password]').count();
      check(passwordInputs === 0, '[工具] 导航页密码输入框数量为 0');
    }
    if (tab.id === 'tool-bitwarden') {
      const passwordInputs = await page.locator('input[type=password]').count();
      check(passwordInputs === 1, '[Bitwarden 解锁] 独立页有且仅有 1 个密码输入框');
    }
    await page.waitForTimeout(1400);

    // 5) 关键元素
    if (tab.text) {
      const paneText = await page.locator('.pane:not([hidden])').innerText();
      for (const t of tab.text) {
        check(paneText.includes(t), `[${tab.label}] 关键文案「${t}」出现`);
      }
    } else if (tab.selector) {
      check((await page.locator(tab.selector).count()) > 0, `[${tab.label}] 关键元素 ${tab.selector} 出现`);
    }

    const res = await checkViewport(page, tab);
    if (res.overflow) {
      check(false, `[${tab.label}] 文档级横向溢出 scrollWidth=${res.overflow.scrollWidth} > clientWidth=${res.overflow.clientWidth}`);
    } else {
      check(true, `[${tab.label}] 无文档级横向溢出`);
    }
    if (res.tables.length === 0) {
      check(true, `[${tab.label}] 可见表格均可容纳或可横滑`);
    } else {
      for (const t of res.tables) {
        check(false, `[${tab.label}] 表格被裁且不可横滑 width=${t.width} right=${t.right} viewport=${t.vw}`);
      }
    }
    if (res.targets.length === 0) {
      check(true, `[${tab.label}] 触摸目标全部达标（主要 40 / 次要 32）`);
    } else {
      for (const t of res.targets) {
        check(false, `[${tab.label}] 触摸目标偏小「${t.text}」.${t.cls} ${t.w}x${t.h} < ${t.min}`);
      }
    }
    if (res.formControls.length === 0) {
      check(true, `[${tab.label}] 表单控件命中区全部 ≥44px`);
    } else {
      for (const f of res.formControls) {
        check(false, `[${tab.label}] 表单控件命中区偏小 .${f.cls} ${f.w}x${f.h} < 44`);
      }
    }
    if (res.formFonts.length === 0) {
      check(true, `[${tab.label}] 表单控件字号全部 ≥16px`);
    } else {
      for (const f of res.formFonts) {
        check(false, `[${tab.label}] 表单控件字号偏小 <${f.tag} class="${f.cls}"> ${f.fs}px < 16`);
      }
    }
    if (res.fonts.length === 0) {
      check(true, `[${tab.label}] 可见文本字号均 ≥12px`);
    } else {
      for (const f of res.fonts) {
        check(false, `[${tab.label}] 字号偏小 <${f.tag} class="${f.cls}"> ${f.fs}px 「${f.text}」`);
      }
    }
  }

  await ctx.close();
  const real = errors.filter((e) => !/Failed to load resource|ERR_|net::/i.test(e));
  check(real.length === 0, `[${vp.width}] 无页面 JS 错误` + (real.length ? ': ' + real.join(' | ') : ''));
}

// 桌面回归哨兵：≥1200px 尺寸不变（按钮仍是 antd 默认 32px 高）
async function runDesktopSentinel(browser) {
  console.log('\n========== desktop sentinel 1280x900 ==========');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([
    { name: '__Host-admin_session', value: 'e2e-fake', domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
  ]);
  await ctx.route('**/*', dispatch);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sidenav');
  await page.waitForTimeout(800);
  const metrics = await page.evaluate(() => {
    const btn = document.querySelector('.topbar .ant-btn');
    const r = btn ? btn.getBoundingClientRect() : null;
    return {
      docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      topBtnHeight: r ? Math.round(r.height) : null
    };
  });
  check(!metrics.docOverflow, '[桌面] 无文档级横向溢出');
  check(metrics.topBtnHeight !== null && metrics.topBtnHeight <= 40, `[桌面] 顶栏按钮仍为默认尺寸（height=${metrics.topBtnHeight}px）`);

  // 表单控件隔离哨兵：打开博客编辑器（有 input/select），桌面鼠标环境必须仍是 antd 默认（32px / 14px），
  // 证明 §5 的 ≥44px / ≥16px 规则只在窄屏 / coarse pointer 生效。
  await page.goto(new URL('/blog', BASE).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pane:not([hidden]) button', { timeout: 15000 });
  await page.locator('.pane:not([hidden]) button', { hasText: '新建文章' }).first().click();
  await page.waitForSelector('.pane:not([hidden]) input.ant-input', { timeout: 10000 });
  await page.waitForTimeout(800);
  const formMetrics = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), fs: parseFloat(getComputedStyle(el).fontSize) };
    };
    return {
      input: pick('.pane:not([hidden]) input.ant-input'),
      select: pick('.pane:not([hidden]) .ant-select-selector'),
      docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    };
  });
  check(!formMetrics.docOverflow, '[桌面] 博客编辑器无文档级横向溢出');
  check(formMetrics.input && formMetrics.input.h <= 40 && formMetrics.input.fs < 16, `[桌面] 输入框仍是 antd 默认（${formMetrics.input ? formMetrics.input.h + 'px / ' + formMetrics.input.fs + 'px' : 'n/a'}）`);
  check(formMetrics.select && formMetrics.select.h <= 40 && formMetrics.select.fs < 16, `[桌面] 选择器仍是 antd 默认（${formMetrics.select ? formMetrics.select.h + 'px / ' + formMetrics.select.fs + 'px' : 'n/a'}）`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: require('./chromium-path.cjs') });
  try {
    for (const vp of VIEWPORTS) await runViewport(browser, vp);
    await runDesktopSentinel(browser);
  } finally {
    await browser.close();
  }
  console.log('\n=================================');
  if (failures === 0) {
    console.log('ALL PASS');
    process.exit(0);
  }
  console.log(`FAILED: ${failures} 项断言未通过`);
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
