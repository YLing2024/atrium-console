/* atrium-console 管理后台 Service Worker（手写，无第三方依赖）。
 *
 * 目标：可安装 + 离线外壳，同时保证「构建即部署」后用户下一跳就能拿到新版本。
 *
 * 更新链路（最高优先级）：
 *   - 导航请求走 network-first：只要在线，index.html 永远来自网络，绝不用旧外壳顶替新部署。
 *   - /assets/* 是 Vite 带内容 hash 的文件，cache-first 安全：hash 变了就是新 URL。
 *   - 不在安装时贪心预缓存整站，只预缓存离线页 + 图标等极小清单，避免旧资源长期驻留。
 *   - 缓存名带版本常量；新版本 activate 时删掉所有旧版本缓存。
 *   - 配合注册侧 updateViaCache: 'none'，绕过 HTTP 缓存检查 sw.js 本身是否有更新。
 *
 * 策略在 SW 内按 URL / 请求类型自行判定，不依赖响应头（响应头由部署环境决定，不可控）。
 * 但「写缓存前」有响应头守卫：带 Set-Cookie、或 Cache-Control 含 no-store/private 的响应
 * 一律不写入（认证/敏感响应不进缓存），导航与静态两个分支共用同一守卫。
 */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `admin-web-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline.html';

// 只预缓存极小清单：离线兜底页与图标；其余一律按需缓存。
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon-180.png'
];

// install：预缓存极小清单，并立刻进入 waiting（skipWaiting 让新 SW 不必等所有标签关闭）。
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 逐个 add 并吞掉单点失败：某个图标 404 不应让整个 SW 安装失败（那会阻断更新）。
      await Promise.all(
        PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined))
      );
      await self.skipWaiting();
    })()
  );
});

// activate：清理所有不属于当前版本的缓存，并立即接管已打开的页面。
// 版本清理放在 activate（而非 install）：旧 SW 在交接期间仍可能服务页面，
// 提前删旧缓存会让离线兜底短暂失效；activate 时旧缓存已无人使用，删除才安全。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

function isAdminEntry(url) {
  // 后台入口只有根路径与 /index.html；只有它们允许回退到缓存的 index.html。
  return url.pathname === '/' || url.pathname === '/index.html';
}

// 写缓存前的响应头守卫：认证相关（Set-Cookie）与显式禁止存储（no-store/private）的响应不进缓存。
// 注：Cache-Control 含 no-cache 只是要求每次校验，不阻止写入；只有 no-store / private 才拒绝。
function isCacheableResponse(response) {
  if (!response || !response.ok) return false;
  const headers = response.headers;
  if (!headers) return true;
  try {
    if (headers.has && headers.has('set-cookie')) return false;
    const cacheControl = (headers.get && headers.get('cache-control')) || '';
    if (/\bno-store\b/i.test(cacheControl) || /\bprivate\b/i.test(cacheControl)) return false;
  } catch {
    // 某些响应头不可读时保守放行写入，避免因守卫本身抛错影响主流程。
    return true;
  }
  return true;
}

// 统一写缓存：先过响应头守卫，再 put，并吞掉 put 失败（避免未处理的 Promise 拒绝）。
function cacheResponse(cache, request, response) {
  if (!isCacheableResponse(response)) return;
  try {
    const copy = response.clone();
    cache.put(request, copy).catch(() => undefined);
  } catch {
    // clone 失败（如 body 已被消费）时忽略，不影响响应返回。
  }
}

// 导航请求：network-first。成功即回写缓存，失败才用缓存兜底。
async function handleNavigate(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    cacheResponse(cache, request, response);
    return response;
  } catch {
    // 同路径缓存优先（例如已访问过的 /public.html）。
    const cached = await cache.match(request);
    if (cached) return cached;

    // 后台入口回退缓存的 index.html（应用外壳）。
    if (isAdminEntry(new URL(request.url))) {
      const shell =
        (await cache.match('/index.html')) || (await cache.match('/'));
      if (shell) return shell;
    }

    // 其余（含 public.html）一律回退离线页，绝不让公开页被后台外壳污染。
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return Response.error();
  }
}

// /assets/*（带 hash）：cache-first。
async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  cacheResponse(cache, request, response);
  return response;
}

// 其他同源静态资源（字体、图片等）：stale-while-revalidate。
function handleStatic(event) {
  const request = event.request;
  const network = fetch(request)
    .then((response) => {
      caches
        .open(CACHE_NAME)
        .then((cache) => cacheResponse(cache, request, response))
        .catch(() => undefined);
      return response;
    })
    .catch(() => undefined);
  // 有缓存立即返回，同时后台静默更新；无缓存则等网络。
  event.waitUntil(network.catch(() => undefined));
  return caches.match(request).then((cached) => cached || network.then((r) => r || Response.error()));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 跨域请求一律不接管，直接放行。
  if (url.origin !== self.location.origin) return;

  // 动态接口、认证路径、终端 / 临时链接：network-only，绝不缓存、绝不拦截。
  // /_auth/ 是网关认证端点（含 set-cookie / 未登录 401），任何形态（含 navigation）都直接放行。
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_auth/') ||
    url.pathname.startsWith('/term/') ||
    url.pathname.startsWith('/s/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(handleAsset(request));
    return;
  }

  // 其余同源 GET（字体、图片、manifest 等）：stale-while-revalidate。
  event.respondWith(handleStatic(event));
});
