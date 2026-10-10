[English](README.en.md) | [简体中文](README.md)

# atrium-console

The admin frontend for the personal site: view the server, manage files and the blog, and connect a terminal, all in the browser.

## What it does

The sidebar has 11 pages in total; panels stay mounted and only toggle visibility, and the last page you were on is remembered for the session (`sessionStorage.admin_tab`).

- **System**: real-time readings and history trends for CPU / memory / disk / network; live readings use streamed sampling, and trends switch between second / minute / hour / day granularity
- **Apps**: a read-only card grid grouped by category, with inline monochrome SVG icons (falling back to the first character when unmatched); status is normal / needs login / slow / error / idle / unknown, where "idle" means an on-demand app is currently not running and is not counted as an error; after entering, it auto-refreshes every 30s and pauses when the page is hidden
- **Public app center**: a second build entry `public.html` (`src/publicApps.tsx` → `src/components/PublicApps.tsx`), fully public and requiring no login: only the title "应用中心", a card grid by category and an update time at the top, auto-refreshing every 30s; it requests only `/api/public/apps` (same-origin relative path) and reuses `AppCard` / `AppIcon` / `appStatus`, with no login page / sidebar / admin entry
- **Version**: software version list, loaded once when the page is entered
- **Blog**: post and collection management over `/api/blog/admin/*`; the body is edited with CodeMirror 6, posts and collections are identified by snowflake `public_id`, and subtitle (`subtitle`) and excerpt (`excerpt`) are independent fields
- **Manage**: login device sessions, API tokens (the plaintext is shown only once at creation), reset authenticator
- **Terminal**: connect to the server terminal in the browser (ttyd + tmux), with multiple tabs; beyond the site login, a separate terminal password is verified, and the ticket is passed to the server-side wrapper via the iframe for validation
- **Files**: an explorer-style file area — directory browsing, drag-and-drop upload (with progress), create / rename / delete / download, and time-limited temporary links
- **Notifications**: notification center (server-sent events push), notification management (send, batch delete, statistics), debug
- **Hermes**: embedded in an iframe at an address injected at build time

`Ctrl/⌘ + K` opens the command palette, which can switch pages, reset the authenticator and log out. On narrow screens (<1024px) the sidebar collapses into a left-side slide-out drawer, and the top menu button is always visible.

## Quick start

```bash
npm install
npm run dev      # Vite dev server (/api proxied to 127.0.0.1:3100)
npm run build    # build; output goes to build.outDir in vite.config.ts (the production directory by default, overridable with BUILD_OUT_DIR)
npm run preview
npm run check    # typecheck + lint + lint:css + check:tokens + test
```

`e2e/` has its own `package.json` (Playwright); a root `npm install` does not install it.

## Configuration

Build-time environment variables; real values live only in the local `.env` (gitignored), and the repo keeps only `.env.example` placeholders:

| Name | Default | Description |
|---|---|---|
| `VITE_HERMES_DASHBOARD_URL` | empty; falls back to `https://hermes.example.com` | iframe address for the sidebar "Hermes" page |
| `VITE_SITE_URL` | empty; falls back to `https://site.example.com` | public site base URL (with protocol, no trailing slash); blog outbound links build absolute addresses from it |

The server-side environment variable `AUTH_MODE` decides the auth mode (see below). The frontend probes it at startup; it is not read at build time.

## Deployment

- The build output is plain static files (the directory is set by `build.outDir` in `vite.config.ts`, currently `/var/www/admin`; `emptyOutDir: true` clears that directory at build time), served by your own web server with no long-running Node process.
- Same-origin endpoints `/api/*` proxy to the backend; terminal `/term/` proxies to ttyd; file temporary links are public addresses returned by the backend (same-origin `/s/` prefix, no auth) and are passed through directly by the web server.
- Environment variables are injected at build time; rebuild after changing them.
- `build.rollupOptions.input` in `vite.config.ts` is **multi-entry**: `index.html` (admin) and `public.html` (the public app center, entry `src/publicApps.tsx`, used as the root of an independent subdomain). The public page requests **only `/api/public/apps`** (it never touches `/api/admin/*` and has no auth logic) and reuses `src/components/AppCard.tsx` (the same component as the admin `Apps.tsx`; its class names and render structure must not be changed).

## PWA

The admin console is an installable PWA: Chromium / Edge show an install entry, iOS Safari supports "Add to Home Screen", and it shows as `standalone` with no address bar. Offline, it shows the app shell plus a clear notice; offline writes are not supported. When the network is unreachable (fetch fails outright) the startup probe renders an "offline" page, while HTTP 4xx/5xx keeps the previous behaviour.

- **Files**: `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`, `public/icons/*.png`; `index.html` links the manifest and `apple-touch-icon`.
- **Cache strategy** (decided inside `sw.js` by request type, not by response headers): navigations are network-first (same-path cache as fallback; the admin entry also falls back to the cached `index.html`, while other paths including `public.html` fall back to `offline.html`); `/assets/*` (Vite hashes) is cache-first; `/api/*`, `/_auth/*`, `/term/*`, `/s/*` are network-only (auth paths are never cached, and their navigations are passed through too); other same-origin static assets are stale-while-revalidate; cross-origin requests are left alone. Install precaches only `offline.html` + icons.
- **Header guard before writing cache**: a single `cacheResponse()` helper checks before every `cache.put` — responses carrying `Set-Cookie`, or `Cache-Control` with `no-store` / `private`, are never written (used by both the navigation and static branches); `put` failures are swallowed so no unhandled rejection is produced.
- **Updates**: the SW calls `skipWaiting()` + `clients.claim()`, and registration uses `updateViaCache: 'none'`. The cache name carries a version constant and `activate` drops old versions. On takeover the page shows a restrained "new version, refresh to update" prompt and lets the user refresh (no auto-reload). **Bump the version constant whenever `sw.js` behavior or precache list changes.**
- **Deployment**: `/sw.js` **must not be long-cached** (use `no-cache`); `sw.js`, `manifest.webmanifest`, `offline.html` and `icons/*.png` must be reachable same-origin. `public.html` has no manifest link so the public page stays independent.
- **Regenerate icons**: `python3 scripts/gen-pwa-icons.py` (requires Python PIL / Pillow).

## Authentication and security

Frontend identity is proven by a same-origin session cookie; no localStorage token is read or written. `src/api.ts` is the only auth entry point; business components do not implement a second auth path.

At startup it probes `GET /api/admin/auth-mode` and caches the result, branching by mode; a failed probe (network error / non-JSON / 404 from an old backend) is always treated as `sso` and never falls back to `builtin`.

| Mode | Behavior |
|---|---|
| `builtin` (default) | built-in account: local login page + `POST /api/admin/login` (6-digit TOTP); `GET /api/admin/me` 401 shows the login page; logout via `POST /api/admin/logout`; any 401 returns to the login page |
| `sso` | built-in passwords off: identity is injected by the upstream auth layer; `GET /_auth/me`; any 401 redirects the whole page to `/_auth/login?next=…`; logout redirects to `/_auth/logout` |

Authenticator reset has two stages: `POST /api/admin/totp/reset` creates a pending secret, then `POST /api/admin/totp/confirm` submits a new code to promote it.

## Interface

Light/dark follows the system by default and can be toggled manually; the choice is stored in `localStorage.admin_theme`. Styles are hand-written CSS, and the design tokens are the same set as atrium (warm paper / ink / a single amber accent); the Inter Tight / Inter / JetBrains Mono fonts are self-hosted under `src/fonts/`.

## License

MIT
