# AGENTS.md — admin-web（管理后台前端）

> 本文件是维护本仓库前先读的约定。README.md 是面向用户的介绍；冲突时以本文件为准。

## 这个项目是什么

个人网站的管理后台前端（React + Vite SPA），部署在 `/admin/`。包含五个功能面：

| Tab | 组件 | 说明 |
|---|---|---|
| 终端 | `Terminal.jsx` | 浏览器内连服务器终端（ttyd + tmux，多标签、口令二次验证） |
| 聊天 | `Main.jsx` / `Browse.jsx` | 与 Hermes 网关对话、历史会话只读浏览 |
| 博客 | `BlogAdmin.jsx` | 文章 / 合集管理（接口走 `/api/blog/admin/*`） |
| 系统 | `System.jsx` | CPU / 内存 / 磁盘 / 网络实时与历史趋势 |
| 管理 | `Manage.jsx` / `VersionPanel.jsx` | 服务状态、版本、API Token、TOTP 重置 |

后端是 `../admin-server`（`:3100`），博客数据在 `../blog/server`（`:4000`）。

## 技术栈

| 项 | 值 |
|---|---|
| 框架 | React 18 + Vite 5（**JSX，不是 TS**） |
| 编辑器 | CodeMirror 6（`MarkdownEditor.jsx`，博客正文） |
| Markdown | `marked` + `dompurify` |
| 其他 | `qrcode`（TOTP 绑定二维码） |
| 样式 | 手写 CSS（`src/styles.css`） |
| 字体 | `src/fonts/` 自托管 Inter / Inter Tight / JetBrains Mono |
| 运行时 | Node 24 / npm 11 |

## 目录结构

```
src/
├── App.jsx / main.jsx      # 登录态判断 + 路由
├── api.js                  # REST 封装、token 存取、401 跳 SSO（唯一鉴权入口）
├── theme.js                # 深浅色，localStorage('admin_theme')
├── fileRefs.js             # @file:<路径> 引用解析
├── imageRefs.js            # @image: / MEDIA 引用解析
├── mediaTags.js            # 受保护片段（代码块等）边界计算
├── styles.css              # 设计令牌 + 全站样式
└── components/
    ├── Main.jsx / Login.jsx / CommandPalette.jsx
    ├── Browse.jsx / System.jsx / Manage.jsx / VersionPanel.jsx
    ├── BlogAdmin.jsx / MarkdownEditor.jsx / ResetTotp.jsx
    └── Terminal.jsx        # 终端 Tab（ttyd iframe、多标签、口令门）
e2e/                        # Playwright 端到端（独立 package.json）
test/                       # 单测
```

## 命令

```bash
npm install
npm run dev      # Vite，base=/admin/，/api 代理到 127.0.0.1:3100
npm run build    # 输出到 /var/www/admin（vite.config.js 写死 outDir + emptyOutDir）
npm run preview
```

> **构建即部署**：`outDir = /var/www/admin`，构建会清空该目录。构建完刷新浏览器即可，无进程需重启。

## 部署

- nginx：主域 `zhangyunling.cn` 下 `location /admin/` → `/var/www/admin`；`/api/admin/*` 反代到 `127.0.0.1:3100`。
- 鉴权链路：浏览器带 `Authorization: Bearer <token>` → nginx `auth_request /auth-check` → 认证中心 `127.0.0.1:3200/api/verify` → 注入 `X-Auth-User` 给后端。
- 终端的额外一层：nginx `location /term/`（WebSocket 透传）→ `ttyd` `127.0.0.1:7681 --base-path /term`，`ttyd-webterm.service`。

## SSO 约定（强约束）

- 认证中心地址**只能**来自构建时环境变量：
  ```js
  (import.meta.env.VITE_AUTH_CENTER_URL || '').trim() || 'https://auth.example.com/auth'
  ```
  见 `src/api.js`。仓库只提交 `.env.example`，真实 `.env` 被 `.gitignore` 忽略。
- 登录回跳格式：`<认证中心>/auth?redirect=<当前地址>` → 回跳 `#token=<token>`（fragment，不进服务器日志）→ 存 `localStorage.auth_token` → 清 URL。
- 任意接口 401 → 清 token → 跳认证中心。**不要在组件里另写一套鉴权逻辑**，统一走 `api.js`。
- 推送前自检：源码里 `grep zhangyunling\|auth\.\|127\.0\.0\.1\|公网 IP` 应为 0（终端 Tab 用同源相对路径 `/term/`，无硬编码）。

## 设计系统（硬性，与 homepage / quotahub / v2link 同一套）

```
--bg #f7f6f3  --fg #171512  --muted #6f6a63  --accent #a05b0c
深色 --bg #13110f  --surface #191715  --fg #efeae3  --accent #c77c1f
字体 Inter Tight / Inter / JetBrains Mono；直角、发丝线、单琥珀点缀、动效 ≤150ms
```

文案：唯美克制，**禁 emoji / 鸡汤 / 网络热词**；UI 不写技术说明性文案。

## 已知坑

- **`Terminal.jsx` 的细节不能想当然**：
  - ttyd 参数是 `--url-arg`：第 1 个 arg = 会话名（`term-*` 白名单 `^term-[a-z0-9][a-z0-9-]{0,31}$`），第 2 个 arg = 口令票据。
  - 关窗必须断连：`pagehide/beforeunload` 用 `navigator.sendBeacon`（**token 必须挂 query**，sendBeacon 不能带自定义头，否则被 nginx SSO 探针拦 401），并用 `performance.getEntriesByType('navigation')[0].type === 'reload'` 区分 F5（刷新要保留会话）。
  - 存活点轮询 6s，iframe `onLoad` 后 0.8s 校正一次，别再把间隔调大（曾 20s 被用户投诉「变绿太慢」）。
- 引用了 Hermes 消息里的 `@file:` / `@image:` / MEDIA 标签时，解析器必须跳过代码块内片段（`mediaTags.js#findProtectedRanges`），否则文档里的示例会被误当附件。
- 这是 **JSX 项目**，不要用 `node --check` 做语法校验（会报错），用 `vite build` 或 eslint。
- 博客后台的文章/合集标识已切到**雪花 ID（`public_id`）**：表单不再手填 slug，只读展示「合集 ID」；改动链接逻辑时前后端（`blog-server`）要一起改。
- `e2e/` 有独立的 `package.json`（Playwright），根目录 `npm install` 不会装它。
