# AGENTS.md — admin-web（管理后台前端）

> 本文件是维护本仓库前先读的约定。README.md 是面向用户的介绍；冲突时以本文件为准。

## 这个项目是什么

个人网站的管理后台前端（React + Vite SPA），部署在 `/admin/`。包含五个功能面：

| Tab | 组件 | 说明 |
|---|---|---|
| 系统 | `System.jsx` | CPU / 内存 / 磁盘 / 网络实时与历史趋势 |
| 版本 | `VersionPanel.jsx` | 软件版本 |
| 博客 | `BlogAdmin.jsx` | 文章 / 合集管理（接口走 `/api/blog/admin/*`） |
| 管理 | `Manage.jsx` | 服务状态、API Token、TOTP 重置 |
| 终端 | `Terminal.jsx` | 浏览器内连服务器终端（ttyd + tmux，多标签、口令二次验证） |
| 文件 | `Files.jsx` | 资源管理器式文件区：目录导航 / 拖拽上传（进度条）/ 新建 / 重命名 / 删除 / 下载 |

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
├── styles.css              # 设计令牌 + 全站样式
└── components/
    ├── Main.jsx / Login.jsx / CommandPalette.jsx
    ├── System.jsx / Manage.jsx / VersionPanel.jsx
    ├── BlogAdmin.jsx / MarkdownEditor.jsx / ResetTotp.jsx
    ├── Terminal.jsx        # 终端 Tab（ttyd iframe、多标签、口令门）
    └── Files.jsx           # 文件 Tab（资源管理器：目录导航/拖拽上传/进度条/增删改）
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
- **「浏览」Tab 已删除**（2026-09-14，用户不用历史会话浏览）：连同 `Browse.jsx`、`fileRefs.js`、`imageRefs.js`、`mediaTags.js` 一并移除。若将来要恢复历史浏览，从 git 历史取回即可；后端 `/api/admin/history` 接口**保留未删**。
- **默认 Tab 是「系统」**：`sessionStorage.admin_tab` 读出的值必须在 `TABS` 白名单内，否则回退 `system`——直接写 `|| 'browse'` 那种回退会白屏。
- 这是 **JSX 项目**，不要用 `node --check` 做语法校验（会报错），用 `vite build` 或 eslint。
- 博客后台的文章/合集标识已切到**雪花 ID（`public_id`）**：表单不再手填 slug，只读展示「合集 ID」；改动链接逻辑时前后端（`blog-server`）要一起改。
- `e2e/` 有独立的 `package.json`（Playwright），根目录 `npm install` 不会装它。

## 项目记忆（PROJECT_MEMORY.md）

**分工**：`AGENTS.md` 记**规则**（稳定、必须遵守）；`PROJECT_MEMORY.md` 记**记忆**（可演进、随事实更新）。
两者冲突时以 `AGENTS.md` 为准；只有经用户明确确认、且长期稳定的规则，才由用户决定升级进 `AGENTS.md`。
`PROJECT_MEMORY.md` 已被 `.gitignore` 拦截：**只存本机，不提交、不推送**。

### 什么时候写

- 读完代码 / 查完日志后，**确认了可复用、长期有效**的结论：API 契约与参数语义、数据模型与单位、踩坑的根因、
  产品与 UI 习惯、历史 bug 的判据（"见到 X 现象就查 Y"）。
- **任务收尾时必须回写**：本次确认了什么、推翻了什么、遗留了什么（写清复核条件）。
- **不要写**：临时猜测、单次偶发现象、未经验证的产品判断、敏感信息（密钥 / token / 口令 / 私有地址）、
  与项目无关的个人偏好、以及从代码一眼可见的常识。

### 每条记忆的字段（缺一不可）

```md
### YYYY-MM-DD · 主题（一句话）
- **结论**：一句话说清（可执行、可判断真假）。
- **适用范围**：哪个模块 / 接口 / 页面；**不适用**的情况也要写。
- **证据**：`路径:行号` / commit / 实测输出摘要（附可复现命令）。
- **复核条件**：什么情况下这条会失效（如"升级 Flutter 大版本后重测"）。
- **最后复核**：YYYY-MM-DD
```

### 迭代规则

1. **先查后写**：任务开始时按关键词（模块名 / 接口名 / 报错文本 / 表名）检索本文件；命中就按结论行事，
   并**把该条的「最后复核」更新为今天**（同一次任务只更新一次，不要刷日期）。
2. **更新优先于新增**：主题已有条目 → 就地改写（结论变了要写"曾认为 X，实测为 Y"），**不要追加重复条目**。
3. **失效即删**：结论被推翻、或复核条件已命中（代码已改 / 版本已升）→ 直接删掉或改写，不留"已废弃"堆积。
4. **合并同类**：同一模块超过 3 条相关记忆 → 合并成一节，只保留最新结论 + 关键证据。

### 容量与清理（硬约束）

- 文件上限 **200 行 / 12 KB**（以 `wc -c` 为准）。超限时按以下优先级淘汰：
  ① 已被代码或配置取代的（先删）→ ② 「最后复核」最久远的 → ③ 证据最弱的（只有结论、没有出处）。
- 单条记忆 **≤ 15 行**；细节过长就把细节留在代码注释 / `references/` 里，本文件只留结论与指针。
- **每次写入后顺手清理一次**（行数、体积、重复项、失效项），保证文件始终处于上限内。
- 清理若删掉仍有价值的内容，必须在提交说明或对话里说明，**不要静默丢弃**。

### 写法

- 读者是**下一个接手这个仓库的人**：用最短的句子、最强的证据，先写结论再写理由。
- 结论要能被证伪：写"接口 X 的 `:id` 是数据库数字 id（`WHERE id = ?`）"，不要写"注意 id 类型"。
- 需要跨文件的长篇背景（架构选型、迁移过程）放 `references/` 或项目文档，这里只留一行指针。
