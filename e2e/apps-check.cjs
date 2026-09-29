/* 应用面板 v2 自测（D2–D8）：SVG 图标 / 首字回退 / idle 休眠 / 深浅主题 / 窄屏单列 / 无 emoji / 无回归
 * 运行：cd e2e && node apps-check.cjs   （需先起 vite dev server：http://localhost:5173/）
 * 后端不在场：路由桩喂 fixture；身份桩 /_auth/me。
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:5173/';

// fixture：4 个已知图标 + 1 个中文单字 + 1 个未知图标名；覆盖 up/auth/degraded/down/unknown/idle
const APPS = {
  generatedAt: '2026-09-30T00:00:00.000Z',
  cached: false,
  notice: null,
  categories: [
    { id: 'core', name: '核心' },
    { id: 'tools', name: '工具' }
  ],
  apps: [
    {
      id: 'app-home',
      name: '主页',
      desc: '主站',
      category: 'core',
      status: 'up',
      icon: 'home',
      port: 443,
      latencyMs: 12,
      url: 'https://home.example.com'
    },
    {
      id: 'app-note',
      name: '笔记',
      desc: '按需唤醒',
      category: 'core',
      status: 'idle',
      icon: 'note',
      onDemand: true,
      port: 3010,
      latencyMs: null
    },
    {
      id: 'app-legacy',
      name: '旧站',
      category: 'tools',
      status: 'auth',
      icon: '书', // 历史中文单字 → 回退首字
      port: 8080
    },
    {
      id: 'app-unknown-icon',
      name: '未知名',
      category: 'tools',
      status: 'unknown',
      icon: 'no-such-icon' // 未命中图标表 → 回退首字
    },
    {
      id: 'app-down',
      name: '异常服务',
      category: 'tools',
      status: 'down',
      icon: 'bell',
      port: 9999,
      latencyMs: null
    },
    {
      id: 'app-slow',
      name: '慢服务',
      category: 'tools',
      status: 'degraded',
      icon: 'gauge',
      port: 7000,
      latencyMs: 1500
    }
  ],
  discovered: []
};

const KNOWN_ICONS = ['home', 'note', 'bell', 'gauge'];

const STUB = { list: [], sessions: [], tokens: [], services: [], versions: [], files: [], shares: [], entries: [], points: [], posts: [], collections: [], system: {} };

async function stub(ctx) {
  // 通配先注册，具体后注册（Playwright 后注册者优先匹配）
  await ctx.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STUB) })
  );
  await ctx.route('**/api/admin/apps*', (route) => {
    const u = new URL(route.request().url());
    appsRequests.push(u.search);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(APPS) });
  });
  await ctx.route('**/_auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sub: 'e2e', name: 'e2e', app: 'admin' }) })
  );
}

const SITE_SESSION_COOKIE = {
  name: '__Host-admin_session',
  value: 'e2e-fake-session',
  domain: 'localhost',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax'
};

let appsRequests = [];

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok - ' + msg);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // ---------- 浅色 + 桌面 ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([SITE_SESSION_COOKIE]);
  await stub(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  console.log('== 浅色 1280x900 ==');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sidenav');
  await page.locator('.sidenav-item', { hasText: /^应用$/ }).click();
  await page.waitForSelector('.apps-card');

  // D8：卡片数量
  const cardCount = await page.locator('.apps-card').count();
  assert(cardCount === APPS.apps.length, `卡片数量正确 (${cardCount}/${APPS.apps.length})`);

  // D8：分组标题
  const groups = await page.locator('.apps-group-name').allTextContents();
  assert(groups.includes('核心') && groups.includes('工具'), '分组标题存在: ' + groups.join('/'));

  // D8：五个原有状态词仍在
  const paneText = await page.locator('.apps').innerText();
  for (const w of ['正常', '需登录', '响应慢', '异常', '未知']) {
    assert(paneText.includes(w), `状态词「${w}」仍在`);
  }

  // D2：已知图标的卡片内有 <svg>，属性符合契约
  const svgCount = await page.locator('.apps-card .apps-icon svg').count();
  assert(svgCount === KNOWN_ICONS.length, `已知图标卡片均渲染 <svg> (${svgCount}/${KNOWN_ICONS.length})`);
  const attrs = await page.locator('.apps-card .apps-icon svg').first().evaluate((el) => ({
    strokeWidth: el.getAttribute('stroke-width'),
    fill: el.getAttribute('fill'),
    stroke: el.getAttribute('stroke'),
    viewBox: el.getAttribute('viewBox'),
    tag: el.tagName.toLowerCase()
  }));
  assert(attrs.tag === 'svg', '图标元素是 <svg>');
  assert(attrs.viewBox === '0 0 24 24', `viewBox=0 0 24 24 (${attrs.viewBox})`);
  assert(attrs.strokeWidth === '1.5', `stroke-width=1.5 (${attrs.strokeWidth})`);
  assert(attrs.fill === 'none', `fill=none (${attrs.fill})`);
  assert(attrs.stroke === 'currentColor', `stroke=currentColor (${attrs.stroke})`);

  // D3：未知图标名 / 中文单字 → 回退成单个文字，无空白卡片
  const legacyBox = await page.locator('.apps-card', { hasText: '旧站' }).locator('.apps-icon').evaluate((el) => ({
    text: el.textContent,
    svg: el.querySelectorAll('svg').length
  }));
  assert(legacyBox.svg === 0 && legacyBox.text === '旧', `中文单字回退首字「${legacyBox.text}」且无 svg`);
  const unknownBox = await page.locator('.apps-card', { hasText: '未知名' }).locator('.apps-icon').evaluate((el) => ({
    text: el.textContent,
    svg: el.querySelectorAll('svg').length
  }));
  assert(unknownBox.svg === 0 && unknownBox.text === '未', `未知图标名回退首字「${unknownBox.text}」且无 svg`);

  // D4：idle → 文案「休眠」+ 状态点 class
  const idleCard = page.locator('.apps-card', { hasText: '笔记' });
  assert((await idleCard.locator('.apps-status').innerText()) === '休眠', 'idle 文案为「休眠」');
  const idleDotClass = await idleCard.locator('.apps-dot').getAttribute('class');
  assert(idleDotClass === 'apps-dot apps-dot--idle', `idle 点 class = ${idleDotClass}`);
  const idleDotStyle = await idleCard.locator('.apps-dot').evaluate((el) => {
    const s = getComputedStyle(el);
    return { h: s.height, w: s.width, bg: s.backgroundColor, radius: s.borderRadius };
  });
  assert(idleDotStyle.h === '1.5px' && idleDotStyle.w === '6px', `idle 点为短横线 (${idleDotStyle.w}×${idleDotStyle.h})`);
  assert(idleDotStyle.bg !== 'rgba(0, 0, 0, 0)', 'idle 点有背景色（非透明）');

  // D8：卡片链接属性 + href 等于接口值
  const homeLink = page.locator('a.apps-card', { hasText: '主页' });
  assert((await homeLink.getAttribute('href')) === 'https://home.example.com', 'href 等于接口返回值');
  assert((await homeLink.getAttribute('target')) === '_blank', 'target=_blank');
  assert((await homeLink.getAttribute('rel')) === 'noopener noreferrer', 'rel=noopener noreferrer');
  assert((await page.locator('div.apps-card', { hasText: '笔记' }).count()) === 1, '无 url 卡片为不可点 <div>');

  // D8：刷新带 refresh=1
  const before = appsRequests.length;
  await page.locator('.apps .system-head .btn-ghost').click();
  await page.waitForTimeout(300);
  const refreshHits = appsRequests.slice(before).filter((q) => q.includes('refresh=1'));
  assert(appsRequests[0] === '', '首拉不带 refresh');
  assert(refreshHits.length >= 1, '点「刷新」请求带 refresh=1');

  // D5：浅色下 stroke 可见且非写死（读计算色）
  const lightStroke = await page.locator('.apps-card .apps-icon svg').first().evaluate(
    (el) => getComputedStyle(el).stroke
  );
  assert(lightStroke && lightStroke !== 'none', `浅色 stroke 可见 (${lightStroke})`);

  await page.screenshot({ path: '/tmp/apps-light.png', fullPage: true });

  // D5：深色主题
  await page.evaluate(() => localStorage.setItem('admin_theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.apps-card');
  const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme || 'auto');
  assert(themeAttr === 'dark', '深色主题已生效 (data-theme=dark)');
  const darkStroke = await page.locator('.apps-card .apps-icon svg').first().evaluate(
    (el) => getComputedStyle(el).stroke
  );
  assert(darkStroke && darkStroke !== 'none', `深色 stroke 可见 (${darkStroke})`);
  assert(darkStroke !== lightStroke, `深浅色 stroke 不同 → 未写死颜色 (${lightStroke} → ${darkStroke})`);
  await page.screenshot({ path: '/tmp/apps-dark.png', fullPage: true });

  // D7：无 emoji
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  const appText = await page.locator('.apps').innerText();
  assert(!emojiRe.test(appText), '应用面板文案无 emoji');

  // D6：窄屏 390px 单列 + 图标不撑破卡片
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const cols = await page.locator('.apps-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  assert(cols.trim().split(/\s+/).length === 1, `窄屏单列 (grid-template-columns=${cols})`);
  const overflow = await page.locator('.apps-card').first().evaluate((card) => {
    const ic = card.querySelector('.apps-icon').getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const svg = card.querySelector('.apps-icon svg');
    return {
      inside: ic.left >= cr.left - 0.5 && ic.right <= cr.right + 0.5,
      svgW: svg ? svg.getBoundingClientRect().width : null,
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth
    };
  });
  assert(overflow.inside, '图标未撑破卡片');
  assert(overflow.svgW !== null && overflow.svgW <= 24, `窄屏 svg 尺寸正常 (${overflow.svgW}px)`);
  assert(overflow.noHScroll, '窄屏无横向滚动条');
  await page.screenshot({ path: '/tmp/apps-narrow.png', fullPage: true });

  await ctx.close();
  await browser.close();

  // D7：控制台零错误
  const realErrors = errors.filter((e) => !/Failed to load resource|ERR_|net::/i.test(e));
  assert(realErrors.length === 0, '控制台零错误' + (realErrors.length ? ': ' + realErrors.join(' | ') : ''));

  console.log('\nALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
