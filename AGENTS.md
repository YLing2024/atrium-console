# AGENTS.md — admin-web（管理后台前端）

> 本文件是维护本仓库前先读的约定。README.md 是面向用户的介绍；冲突时以本文件为准。

## 这个项目是什么

个人网站的管理后台前端（React + Vite SPA），部署在独立子域（域名与反代见你自己的部署）。包含以下功能面：

| Tab | 组件 | 说明 |
|---|---|---|
| 系统 | `System.tsx` | CPU / 内存 / 磁盘 / 网络实时趋势（SSE）；进程全量树走 `/api/admin/services`，仅 Tab 激活时每 5s 取样（SSE 不再携带进程明细） |
| 应用 | `Apps.tsx` | 服务器应用面板：按分类的卡片网格、SVG 图标（`AppIcon.tsx`，缺省回退首字）、状态点（正常/需登录/响应慢/异常/休眠/未知）、30s 自动刷新（只读，接口 `/api/admin/apps`） |
| 版本 | `VersionPanel.tsx` | 软件版本 |
| 博客 | `BlogAdmin.tsx` | 文章 / 合集管理（接口走 `/api/blog/admin/*`） |
| 管理 | `Manage.tsx` | 服务状态、API Token、TOTP 重置 |
| 终端 | `Terminal.tsx` | 浏览器内连服务器终端（ttyd + tmux，多标签、口令二次验证） |
| 文件 | `Files.tsx` | 资源管理器式文件区：目录导航 / 拖拽上传（进度条）/ 新建 / 重命名 / 删除 / 下载 |

后端是 `../admin-server`，博客数据在 `../blog/server`。

## 技术栈

| 项 | 值 |
|---|---|
| 框架 | React 18 + Vite 5 + TypeScript（`strict`，校验用 `npm run typecheck`） |
| 编辑器 | CodeMirror 6（`MarkdownEditor.tsx`，博客正文） |
| Markdown | `marked` + `dompurify` |
| 其他 | `qrcode`（TOTP 绑定二维码） |
| 样式 | 手写 CSS（入口 `src/styles.css` 只 `@import`，分区在 `src/styles/`） |
| 字体 | `src/fonts/` 自托管 Inter / Inter Tight / JetBrains Mono |
| 运行时 | Node 24 / npm 11 |

## 目录结构

```
src/
├── App.tsx / main.tsx      # 后台入口：启动探测认证模式 + 身份 + 路由
├── publicApps.tsx          # 公开「应用中心」入口（对应根目录 public.html，多入口之一）
├── api.ts                  # REST 封装、认证模式探测、全局 401（唯一鉴权入口）
├── theme.ts                # 深浅色，localStorage('admin_theme')
├── styles.css              # 样式唯一入口：仅按顺序 @import ./styles/*.css
├── styles/                 # 按既有分区注释拆分的 partial（顺序即层叠，勿重排）
└── components/
    ├── Main.tsx / CommandPalette.tsx
    ├── System.tsx / Manage.tsx / VersionPanel.tsx
    ├── BlogAdmin.tsx / MarkdownEditor.tsx / ResetTotp.tsx
    ├── Apps.tsx / AppIcon.tsx  # 应用 Tab（卡片网格 + 内联 SVG 图标集）
    ├── AppCard.tsx / PublicApps.tsx  # 共用应用卡片 / 公开只读「应用中心」页
    ├── LoginPage.tsx       # 自带账号登录页（builtin 模式，TOTP 动态码）
    ├── Terminal.tsx        # 终端 Tab（ttyd iframe、多标签、口令门）
    └── Files.tsx           # 文件 Tab（资源管理器：目录导航/拖拽上传/进度条/增删改）
e2e/                        # Playwright 端到端（独立 package.json）
test/                       # 单测
```

## 命令

```bash
npm install
npm run dev      # Vite 开发服务器（接口代理见 vite.config.ts）
npm run build    # 构建（outDir 见 vite.config.ts；默认写生产目录，可用 BUILD_OUT_DIR 覆盖）
npm run preview
npm run check    # typecheck + lint + lint:css + check:tokens + test（改完代码先跑这个）
```

工程化基线（2026-09-30 落地）：ESLint（typescript-eslint + react-hooks，只正确性规则）、Stylelint（只正确性规则）、
`node:test` 单测（24 例，纯函数）、旧调色板清零守卫 `scripts/check-tokens.mjs`（源码里不得再出现旧令牌 `var(--...)` 引用与旧调色板字面色值）。
纯函数已从组件抽到 `src/{appIcons,appStatus,format}.ts` 以便测试（搬移式，字符串字面量零变化）。

> **构建即部署**：`vite.config.ts` 里写死了 `outDir` + `emptyOutDir`，构建会清空该目录。构建完刷新浏览器即可，无进程需重启。
>
> **验证构建用独立输出目录**，别用 `npm run build`（会覆盖生产目录）：
> `npx vite build --outDir /tmp/admin-web-verify --emptyOutDir`

## 部署

- 构建产物是静态文件，交给自己的 Web 服务器托管；接口路径 `/api/*`、临时链接 `/s/<token>`（公开，不加鉴权）、终端 `/term/`（ttyd）按自己的部署反代到对应后端。
- 具体域名、反代与认证接线属于使用者自己的部署，不在本仓库展开。

## PWA（强约束）

- 静态文件：`public/manifest.webmanifest`、`public/sw.js`、`public/offline.html`、`public/icons/*.png`（由 `scripts/gen-pwa-icons.py` 生成，PIL，幂等）。`sw.js` 手写单文件，**零新增依赖**（不引 `vite-plugin-pwa` / `workbox-*`）。
- **只注册后台入口**：`src/pwa.ts` 仅在 `import.meta.env.PROD` 注册 `/sw.js`，开发态注销全部 SW 并清空缓存；注册在 `src/main.tsx` 引入。`index.html` 不再有「注销 SW」脚本，也不要再往回加。
- **缓存策略在 SW 内按请求类型判定**（不看响应头）：导航 network-first（后台入口回退缓存 `index.html`，**`public.html` 等一律回退 `offline.html`**，公开页不得被后台外壳污染）；`/assets/*` cache-first；`/api/*`、`/_auth/*`、`/term/*`、`/s/*` network-only（**认证相关路径永不缓存，navigation 形态也一律放行**）；其余同源静态资源 stale-while-revalidate；跨域不接管。安装只预缓存 `offline.html` + 图标等极小清单。
- **写缓存有响应头守卫**：`cacheResponse()` 统一在 `cache.put` 前判断，响应带 `Set-Cookie` 或 `Cache-Control` 含 `no-store`/`private` 一律不写入（导航与静态分支共用），`put` 失败静默吞掉，不产生未处理拒绝。
- **网络不可达状态页**：`src/App.tsx` 启动探测若 `fetch` 直接 reject（`isNetworkError`，即 `TypeError`）→ 渲染 `src/components/OfflineNotice.tsx`（「当前离线」+ 刷新按钮，样式为 `components.css` 的 `.offline-*`）；收到 HTTP 4xx/5xx 维持原处理（不渲染应用），加载中状态不变。
- **更新最高优先级**：SW `skipWaiting()` + `clients.claim()`，注册用 `updateViaCache: 'none'`；缓存名带版本常量，`activate` 删除旧版本缓存；新版本接管时 `src/pwa.ts` 弹克制提示「有新版本，刷新即可更新」，由用户刷新（不自动刷新）。**改 `sw.js` 行为或缓存清单时必须同步提升版本常量**。
- **部署**：`/sw.js` **不得被长缓存**（建议 `no-cache`），否则发现不了新版本；同源可访问 `/sw.js`、`manifest.webmanifest`、`offline.html`、`icons/*.png`。`public.html` 不加 `manifest` 链接，保持公开页独立。
- 文案克制、禁 emoji / 技术说明；不新增依赖、不改既有样式分区顺序；**不改 `src/api.ts` 的鉴权流程**（仅可追加纯辅助函数，如 `isNetworkError`）。

## 鉴权约定（强约束）

- 特性：默认自带账号口令，开箱即用；也可以关掉自带口令。
- 模式（服务端环境变量 `AUTH_MODE`）：

  | 模式 | 说明 |
  |---|---|
  | `builtin`（默认） | 自带账号口令：本服务自己的登录页 + 会话 cookie |
  | `sso` | 关掉自带口令，管理端身份由 `X-Auth-User` 决定——自家项目接 SSO 时走这一档 |

- 关掉后的登录跳转与 401 由你前面的认证层决定，本服务不再展开。
- 具体实现：`src/api.ts` 启动探测后端 `auth-mode` 并按模式分发，`App.tsx` 未登录时渲染 `LoginPage.tsx`（仅 `builtin`）；401 统一走 `api.ts` 全局出口，**不要在组件里另写一套鉴权逻辑**。契约细节见 `api.ts` 头注释。
- 侧栏「Hermes」页的 iframe 地址**只能**来自构建时环境变量：
  ```js
  (import.meta.env.VITE_HERMES_DASHBOARD_URL || '').trim() || 'https://hermes.example.com'
  ```
  见 `src/components/Hermes.tsx`。真实域名只写本地 `.env`，仓库只提交 `.env.example` 的占位项。
- 推送前自检：源码里不得出现真实域名 / 私有 IP / 私有路径（示例一律 `example.com`）；终端 Tab 用同源相对路径 `/term/`，Hermes 地址走 `VITE_HERMES_DASHBOARD_URL`。

## 公共站点链接（强约束）

- 后台在独立子域，**跳转公共站点（博客前台）的链接/窗口一律走 `siteUrl()`**（`src/siteUrl.ts`，全仓唯一拼接入口）：不得写相对路径（如 `/blog/<id>`，在后台子域上会解析到后台自己），也不得写死域名。
- 公共站点基址来自构建期环境变量 `VITE_SITE_URL`（含协议，末尾不带斜杠）；仓库只提交 `.env.example` 占位值 `https://site.example.com`，真实值只写本地 `.env`。
- 例外：图片/接口等**同源**请求仍用相对路径（`/api/...`），不走 `siteUrl()`。
- 后端返回的链接（如草稿 `preview-link` 的 `url`）已由后端拼成绝对地址，前端**直接使用，不得再拼一次**。

## 文章「副标题」（强约束）

- 文章表单里有独立的「副标题」输入（状态字段 `subtitle`，紧邻「标题」下方），随表单一起提交；留空即空串，前台不显示。
- `subtitle` 与 `excerpt`（摘要）**语义不同**：不要复用、不要自动带出、不要互相赋值。
- 列表不展示副标题（保持简洁）。

## 应用图标与「休眠」状态（强约束）

- 卡片图标走 `src/components/AppIcon.tsx`：内联 31 个 24×24 单色描边 SVG（key = 登记表 `icon`），`name` 未命中（含历史中文单字、`undefined`）回退成单个文字。颜色一律 `currentColor`（深浅主题通用），**不新增依赖、不引图标库、不用 emoji**；图标表是模块内静态常量，改动须整体照抄、不得"优化"路径与坐标。
- 接口 `status: "idle"`（按需唤醒应用当前未运行、探活不通属正常）文案「休眠」，点样式 `.apps-dot--idle`（短横线、次要文字色）；`idle` **不计入**异常。状态点 class 沿用 `apps-dot apps-dot--${status}`，不为 idle 单开分支。

## 公开「应用中心」页（强约束）

- 独立入口 `public.html` → `src/publicApps.tsx` → `src/components/PublicApps.tsx`；Vite 多入口（`build.rollupOptions.input` 同时含 `index.html` 与 `public.html`），后台 `index.html` 入口不变。
- 页面完全公开、不需要登录：无登录页 / 侧栏 / 其它 Tab / 管理入口；**只请求 `/api/public/apps`**（同源相对路径，不拼域名、不走 `api.ts` 的鉴权探测与 401 跳转）。
- 卡片复用 `AppCard.tsx`（与后台同一组件，不得改动其类名与渲染结构），按 `categories` 分组、30s 自动刷新；有 `url` 才可点，新窗口 `target="_blank" rel="noopener noreferrer"`。
- 不引入新依赖、禁 emoji、UI 不写技术说明性文案。

## 设计系统（硬性）

- **颜色一律取 antd 默认 token**：组件里用 antd 组件 / `theme.useToken()`，纯 CSS 用 cssVar 模式下的 `--ant-*` 变量（如 `--ant-color-text`、`--ant-color-text-secondary`、`--ant-color-bg-container`、`--ant-color-border`、`--ant-color-primary`、`--ant-color-error`）。深浅两套由 antd 的 default / dark 算法生成。
- **不保留自建调色板、不做自定义 token 映射**：不要新增 `--bg` / `--fg` / `--accent` 之类的自定义色板；过渡动效沿用 `ease`（≤150ms）。
- 公开「应用中心」页不引 antd：与后台共用的纯 CSS 规则（`src/styles/{base,apps,monitoring}.css`）对 `--ant-*` 变量加了系统色兜底（`Canvas` / `CanvasText` / `GrayText` / `ButtonBorder` / `AccentColor`），公开页据此自动适配深浅。
- 文案：唯美克制，**禁 emoji / 鸡汤 / 网络热词**；UI 不写技术说明性文案。

## 已知坑

- **`Terminal.tsx` 的细节不能想当然**：
  - ttyd 参数是 `--url-arg`：第 1 个 arg = 会话名（`term-*` 白名单 `^term-[a-z0-9][a-z0-9-]{0,31}$`），第 2 个 arg = 口令票据。
  - 关窗必须断连：`pagehide/beforeunload` 用 `navigator.sendBeacon`（同源请求自带会话 cookie，不再在 query 里挂 token；sendBeacon 不能带自定义头），并用 `performance.getEntriesByType('navigation')[0].type === 'reload'` 区分 F5（刷新要保留会话）。
  - 存活点轮询 6s，iframe `onLoad` 后 0.8s 校正一次，别再把间隔调大（曾 20s 被用户投诉「变绿太慢」）。
- **「浏览」Tab 已删除**（2026-09-14，用户不用历史会话浏览）：连同 `Browse.tsx`、`fileRefs.ts`、`imageRefs.ts`、`mediaTags.ts` 一并移除。若将来要恢复历史浏览，从 git 历史取回即可；后端 `/api/admin/history` 接口**保留未删**。
- **默认 Tab 是「系统」**：`sessionStorage.admin_tab` 读出的值必须在 `TABS` 白名单内，否则回退 `system`——直接写 `|| 'browse'` 那种回退会白屏。
- 这是 **TypeScript 项目**（`.ts`/`.tsx` + `strict`）：类型/语法校验用 `npm run typecheck`（`tsc --noEmit`）或 `vite build`；不要用 `node --check`（不认 TS 语法）。
- 博客后台的文章/合集标识已切到**雪花 ID（`public_id`）**：表单不再手填 slug，只读展示「合集 ID」；改动链接逻辑时前后端（`blog-server`）要一起改。
- `e2e/` 有独立的 `package.json`（Playwright），根目录 `npm install` 不会装它。

