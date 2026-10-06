[简体中文](README.md) ｜ [English](README.en.md)

# atrium-console

个人网站的管理后台前端：在浏览器里查看服务器、管理文件与博客、连接终端。

## 它能做什么

侧栏共 11 个页面，面板常驻挂载、只切换显隐，会话内记住上次停留的页面（`sessionStorage.admin_tab`）。

- **系统**：CPU / 内存 / 磁盘 / 网络的实时读数与历史趋势；实时走流式采样，趋势可按秒 / 分 / 时 / 天切换粒度
- **应用**：按分类的只读卡片网格，内联单色 SVG 图标（未命中回退首字）；状态分正常 / 需登录 / 响应慢 / 异常 / 休眠 / 未知，其中「休眠」表示按需唤醒的应用当前未运行，不计入异常；进入后每 30s 自动刷新，页面隐藏时暂停
- **公开应用中心**：第二个构建入口 `public.html`（`src/publicApps.tsx` → `src/components/PublicApps.tsx`），完全公开、不需要登录：只有标题「应用中心」+ 按分类的卡片网格 + 顶部更新时间，30s 自动刷新；只请求 `/api/public/apps`（同源相对路径），复用 `AppCard` / `AppIcon` / `appStatus`，无登录页 / 侧栏 / 管理入口
- **版本**：软件版本列表，进入该页时加载一次
- **博客**：文章与合集管理，走 `/api/blog/admin/*`；正文用 CodeMirror 6 编辑，文章 / 合集以雪花 `public_id` 标识，副标题（`subtitle`）与摘要（`excerpt`）是相互独立的字段
- **管理**：登录设备会话、接口令牌（明文仅在生成时展示一次）、重置验证器
- **终端**：浏览器内连服务器终端（ttyd + tmux），多标签；站点登录之外再验一次终端口令，票据随 iframe 传给服务端 wrapper 校验
- **文件**：资源管理器式文件区——目录浏览、拖拽上传（带进度）、新建 / 重命名 / 删除 / 下载，以及限时临时链接
- **通知**：通知中心（服务端 SSE 实时推送）、通知管理（发送、批量删除、统计）、调试
- **Hermes**：以 iframe 嵌入构建期注入的地址

`Ctrl/⌘ + K` 打开命令面板，可切页、重置验证器、退出登录。窄屏（<1024px）侧栏收为左侧滑出抽屉，顶部菜单按钮常驻。

## 快速开始

```bash
npm install
npm run dev      # Vite 开发服务器（/api 代理到 127.0.0.1:3100）
npm run build    # 构建，产物写入 vite.config.ts 的 build.outDir（默认生产目录，可用 BUILD_OUT_DIR 覆盖）
npm run preview
npm run check    # typecheck + lint + lint:css + check:tokens + test
```

`e2e/` 有独立的 `package.json`（Playwright），根目录 `npm install` 不会安装它。

## 配置

构建期环境变量，真实值只写在本地 `.env`（已 gitignore），仓库只留 `.env.example` 占位：

| 名称 | 默认值 | 说明 |
|---|---|---|
| `VITE_HERMES_DASHBOARD_URL` | 空；回退 `https://hermes.example.com` | 侧栏「Hermes」页 iframe 地址 |
| `VITE_SITE_URL` | 空；回退 `https://site.example.com` | 公共站点基址（含协议、末尾无斜杠），博客外链据此拼绝对地址 |

服务端环境变量 `AUTH_MODE` 决定认证模式（见下），前端启动时探测，构建时不读取。

## 部署

- 构建产物是纯静态文件（目录由 `vite.config.ts` 的 `build.outDir` 指定，当前为 `/var/www/admin`；`emptyOutDir: true` 会在构建时清空该目录），交给自己的 Web 服务器托管，无 Node 进程常驻。
- 同源接口 `/api/*` 反代到后端；终端 `/term/` 反代到 ttyd；文件临时链接是后端返回的公开地址（同源 `/s/` 前缀，不加鉴权），由 Web 服务器直接放行。
- 环境变量在构建期注入，改动后需重新构建。
- `vite.config.ts` 的 `build.rollupOptions.input` 是**多入口**：`index.html`（后台）与 `public.html`（公开「应用中心」，入口 `src/publicApps.tsx`，独立子域根用它）。公开页**只请求 `/api/public/apps`**（不碰 `/api/admin/*`、无鉴权逻辑），复用 `src/components/AppCard.tsx`（后台 `Apps.tsx` 同一组件，不得改动其类名与渲染结构）。

## 认证与安全

前端身份由同源会话 cookie 证明，不读写 localStorage token；`src/api.ts` 是唯一鉴权入口，业务组件不另写一套鉴权逻辑。

启动时探测 `GET /api/admin/auth-mode` 并缓存，按模式分流；探测失败（网络错误 / 非 JSON / 旧后端 404）一律按 `sso`，不回退 `builtin`。

| 模式 | 行为 |
|---|---|
| `builtin`（默认） | 自带账号：本地登录页 + `POST /api/admin/login`（6 位 TOTP 动态码）；`GET /api/admin/me` 401 显示登录页；退出 `POST /api/admin/logout`；任意接口 401 回登录页 |
| `sso` | 关掉自带口令：身份由前置认证层注入；`GET /_auth/me`；任意接口 401 整页跳 `/_auth/login?next=…`；退出跳 `/_auth/logout` |

验证器重置分两阶段：`POST /api/admin/totp/reset` 生成 pending secret，再用 `POST /api/admin/totp/confirm` 提交新码转正。

## 界面

深浅色默认跟随系统，可手动切换，选择记在 `localStorage.admin_theme`。样式为手写 CSS，设计令牌与 atrium 同一套（暖纸 / 墨色 / 单一琥珀点缀），Inter Tight / Inter / JetBrains Mono 字体自托管于 `src/fonts/`。

## 许可证

MIT
