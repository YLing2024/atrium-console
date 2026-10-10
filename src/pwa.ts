/*
 * PWA 注册与更新。
 *
 * 只在生产构建注册：开发态主动注销全部 Service Worker 并清空缓存，
 * 避免本地开发时被上一次构建的缓存干扰。
 *
 * 更新策略：自动接管 + 刷新提示（选提示侧）。
 *   - SW 自身 skipWaiting() + clients.claim()，新版会尽快接管；
 *   - 页面在 controllerchange 时给出克制提示，由用户点「刷新」完成切换。
 * 选提示而非自动刷新，是因为后台有博客正文等长时间编辑，
 * 自动刷新会在用户不知情时丢掉未保存的内容；提示则由用户决定切换时机。
 */

const UPDATE_TEXT = '有新版本，刷新即可更新';

function showUpdateBar(onRefresh: () => void): void {
  if (document.getElementById('pwa-update-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'pwa-update-bar';
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:24px',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:16px',
    'padding:10px 10px 10px 16px',
    'background:var(--surface,#fbfaf8)',
    'color:var(--fg,#171512)',
    'border:1px solid var(--border,rgba(23,21,18,.16))',
    'font-family:var(--font,sans-serif)',
    'font-size:13px',
    'line-height:1.4'
  ].join(';');

  const text = document.createElement('span');
  text.textContent = UPDATE_TEXT;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '刷新';
  button.style.cssText = [
    'border:0',
    'padding:6px 12px',
    'cursor:pointer',
    'background:var(--accent,#a05b0c)',
    'color:#fff',
    'font:inherit'
  ].join(';');
  button.addEventListener('click', onRefresh);

  bar.append(text, button);
  document.body.appendChild(bar);
}

async function unregisterServiceWorkers(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

function registerServiceWorker(): void {
  // 首屏加载时是否已由旧 SW 控制：只有「老页面 → 新 SW」才算版本更新，
  // 首次安装触发 clients.claim() 的 controllerchange 不该提示。
  const hadController = Boolean(navigator.serviceWorker.controller);

  let registration: ServiceWorkerRegistration | undefined;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    showUpdateBar(() => window.location.reload());
  });

  // 长驻标签页里，浏览器未必会主动检查更新；重新可见时补一次。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      registration?.update().catch(() => undefined);
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      // updateViaCache: 'none' —— 绕过 HTTP 缓存检查 sw.js 本身，确保部署后立即发现新版本。
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
      })
      .catch(() => {
        // 注册失败不影响后台正常使用。
      });
  });
}

export function initPwa(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (import.meta.env.PROD) {
    registerServiceWorker();
  } else {
    void unregisterServiceWorkers();
  }
}
