/* 侧栏导航自测：桌面侧栏 / 窄屏右侧抽屉 / 点击切换 / 命令面板 / no 横向滚动
 * 运行：cd e2e && node sidebar-check.cjs   （node 按脚本目录解析 playwright）
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:5173/';
const LABELS = ['系统', '版本', '博客', '管理', '终端', '文件'];

// 后端不在场：把 /api/** 全部桩成 200，避免 401 触发 SSO 跳转（只测导航外观）
const STUB = {
  list: [],
  sessions: [],
  tokens: [],
  services: [],
  versions: [],
  files: [],
  shares: [],
  entries: [],
  points: [],
  posts: [],
  collections: [],
  system: {}
};
async function stubApi(ctx) {
  await ctx.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STUB)
    })
  );
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok - ' + msg);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // ---------- 桌面 ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('auth_token', 'e2e-fake-token'));
  await stubApi(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  console.log('== 桌面 1280x800 ==');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sidenav');

  // 侧栏在左、可见、约 200px
  const nav = await page.locator('.sidenav').boundingBox();
  assert(nav && nav.x === 0, '侧栏贴左 (x=' + (nav && nav.x) + ')');
  assert(nav && nav.width >= 190 && nav.width <= 210, '侧栏宽度约 200px (w=' + (nav && nav.width) + ')');
  const toggleHidden = await page.locator('.nav-toggle').isVisible();
  assert(!toggleHidden, '桌面隐藏菜单按钮');

  // 标签文字与顺序
  const texts = await page.locator('.sidenav-item').allTextContents();
  assert(JSON.stringify(texts) === JSON.stringify(LABELS), '侧栏标签与顺序一致: ' + texts.join('/'));

  // 无横向滚动条
  const noHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  );
  assert(noHScroll, '桌面无横向滚动条');

  // 默认系统 active
  assert(
    (await page.locator('.sidenav-item.active').innerText()) === '系统',
    '默认选中「系统」'
  );

  // 点击「博客」→ active + pane 显隐正确 + sessionStorage
  await page.locator('.sidenav-item', { hasText: '博客' }).click();
  assert(
    (await page.locator('.sidenav-item.active').innerText()) === '博客',
    '点击「博客」后高亮跟进'
  );
  const paneState = await page.evaluate(() => {
    const panes = [...document.querySelectorAll('.content > .pane')];
    return panes.map((p) => p.hasAttribute('hidden'));
  });
  assert(
    JSON.stringify(paneState) === JSON.stringify([true, true, false, true, true, true]),
    '仅博客 pane 可见，其余 hidden（挂载语义未变）: ' + paneState.join(',')
  );
  const saved = await page.evaluate(() => sessionStorage.getItem('admin_tab'));
  assert(saved === 'blog', 'sessionStorage.admin_tab = blog');

  // 终端 pane 挂载后不因切走被卸载
  await page.locator('.sidenav-item', { hasText: '终端' }).click();
  await page.waitForSelector('.term-gate');
  await page.locator('.sidenav-item', { hasText: '博客' }).click();
  assert((await page.locator('.term-gate').count()) === 1, '切走后终端 pane 仍在 DOM（未卸载）');

  // 刷新后停留在上次 Tab（白名单读取未变）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sidenav');
  assert(
    (await page.locator('.sidenav-item.active').innerText()) === '博客',
    '刷新后仍停留在「博客」'
  );

  // 命令面板切换仍可用：Ctrl+K → 点「打开文件」
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.cmd-palette');
  await page.locator('.cmd-item', { hasText: '打开文件' }).click();
  await page.waitForTimeout(150);
  assert(
    (await page.locator('.sidenav-item.active').innerText()) === '文件',
    '命令面板切到「文件」仍可用'
  );

  // ---------- 窄屏 ----------
  console.log('== 窄屏 800x800 ==');
  await page.setViewportSize({ width: 800, height: 800 });
  await page.waitForTimeout(150);
  const toggleVisible = await page.locator('.nav-toggle').isVisible();
  assert(toggleVisible, '窄屏菜单按钮可见（导航不被隐藏）');
  const navBoxNarrow = await page.locator('.sidenav').boundingBox();
  assert(
    navBoxNarrow && navBoxNarrow.x >= 800 - 1,
    '窄屏侧栏默认收在右侧屏外 (x=' + (navBoxNarrow && navBoxNarrow.x) + ')'
  );
  const noH = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  );
  assert(noH, '窄屏无横向滚动条');

  // 打开抽屉
  await page.locator('.nav-toggle').click();
  await page.waitForTimeout(300);
  const openBox = await page.locator('.sidenav').boundingBox();
  assert(openBox && openBox.x < 800, '点菜单按钮后抽屉滑入 (x=' + (openBox && openBox.x) + ')');
  assert(await page.locator('.sidenav-backdrop').isVisible(), '抽屉带遮罩');
  await page.screenshot({ path: '/tmp/sidebar-narrow-open.png' });

  // 点条目 → 关闭抽屉
  await page.locator('.sidenav-item', { hasText: '管理' }).click();
  await page.waitForTimeout(300);
  assert(
    (await page.locator('.sidenav-item.active').innerText()) === '管理',
    '抽屉内点「管理」切换生效'
  );
  const closedBox = await page.locator('.sidenav').boundingBox();
  assert(closedBox && closedBox.x >= 800 - 1, '选中条目后抽屉关闭');

  // 再开 → 点遮罩关闭
  await page.locator('.nav-toggle').click();
  await page.waitForTimeout(300);
  await page.locator('.sidenav-backdrop').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  const maskClosed = await page.locator('.sidenav').boundingBox();
  assert(maskClosed && maskClosed.x >= 800 - 1, '点遮罩后抽屉关闭');

  await page.screenshot({ path: '/tmp/sidebar-narrow.png' });
  await ctx.close();

  // ---------- 白名单回退 ----------
  console.log('== sessionStorage 非法值回退 ==');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx2.addInitScript(() => {
    localStorage.setItem('auth_token', 'e2e-fake-token');
    sessionStorage.setItem('admin_tab', 'browse'); // 旧版残留
  });
  await stubApi(ctx2);
  const page2 = await ctx2.newPage();
  await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('.sidenav');
  assert(
    (await page2.locator('.sidenav-item.active').innerText()) === '系统',
    "非法值 'browse' 回退到「系统」"
  );
  await page2.screenshot({ path: '/tmp/sidebar-desktop.png' });
  await ctx2.close();

  await browser.close();

  const realErrors = errors.filter((e) => !/Failed to load resource|ERR_|net::/i.test(e));
  if (realErrors.length) {
    console.log('\nJS 错误：\n' + realErrors.join('\n'));
    throw new Error('页面存在 JS 错误');
  }
  console.log('\nALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
