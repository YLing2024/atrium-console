# 需求：后台新增「数据库」Tab（内嵌 DBGate）

> 本轮只改 **admin-web**（前端）。后端 `admin-server` 与 `blog-server` 无改动。

## 一、目标

后台侧栏新增一个 Tab「数据库」，点开即用：**不出现任何登录页、不要求二次输入数据库口令**，直接看到已预置的云 MySQL 连接与全部库表。

已由部署侧定好的接线（前端**只消费**，不要自行设计鉴权）：

| 事项 | 现状 |
|---|---|
| DBGate | 容器化部署，`WEB_ROOT=/db`，监听 `127.0.0.1`（不对外） |
| 对外路径 | **同源相对路径 `/db/`**（与终端 Tab 的 `/term/` 完全同一套） |
| 鉴权 | 该路径由前置 Auth Gateway 统一拦截，用的是**后台同一张会话 cookie**；未登录会被网关重定向到登录页 |
| DBGate 自身登录 | 已关闭（服务端配置），连接与凭据已预置，打开即已登录、开箱可连 |
| 前端职责 | 只负责把 `/db/` 嵌进来，**不写域名、不加环境变量、不碰 `api.ts` 的鉴权流程** |

## 二、改动清单（文件级）

### 1. `src/components/Main.tsx`

- `TABS` 数组**末尾追加** `'db'`（现有 11 项的相对顺序一律不动）。
- `TAB_LABELS` 追加 `db: '数据库'`。
- 顶部 `import Database from './Database';`（放在 `Hermes` 之后）。
- `Content` 内按既有 `div.pane` 模式追加一个面板（放在 `hermes` 面板之后）：

  ```tsx
  <div className="pane pane--db" hidden={tab !== 'db'}>
    <Database active={tab === 'db'} />
  </div>
  ```

- 注意：Tab 应用顺序与 `sessionStorage.admin_tab` 白名单回退逻辑**不要动**（非白名单值仍回退 `system`）。

### 2. `src/components/CommandPalette.tsx`

- 在「打开 Hermes」之后追加一条命令，风格照抄相邻条目：
  `{ id: 'db', label: '打开数据库', hint: '云 MySQL 管理与查询', run: () => propsRef.current.onSwitchTab('db') }`

### 3. 新增 `src/components/Database.tsx`

职责：内嵌同源 DBGate 页面。

- **同源相对路径** `src="/db/"`，**不得**使用环境变量或绝对域名（终端 Tab 用 `/term/` 即先例）。
- **延迟挂载**：该 Tab 的面板在 `Content` 里是常驻挂载（仅 `hidden` 切换显隐），所以**必须等 `active` 首次为 `true` 才渲染 iframe**，避免每次打开后台都去拉起 DBGate 的前端。首次激活后**保持挂载**（切走不卸载），以免丢失正在浏览的表/查询状态；`active` 变化只用于"是否已经激活过"的判定。
- 工具条（结构与样式思路照抄 `Hermes.tsx` / `hermes.css`）：标题「数据库」、窄屏提示「窄屏下建议新窗口打开」、「新窗口打开」按钮（`window.open('/db/', '_blank', 'noopener,noreferrer')`）、「刷新」按钮（用 `key` 重挂 iframe）。
- iframe 属性：`src="/db/"`、`title="数据库"`、`referrerPolicy="no-referrer"`、`allow="clipboard-read; clipboard-write"`，**铺满内容区且不产生双层滚动条**。
- 文件头写 TSDoc：说明"为何用同源相对路径"、"为何延迟挂载"、"鉴权由前置网关负责，本组件不写任何鉴权逻辑"。
- `active` 参数类型显式声明，不得用 `any`；无 `active` 传入时的默认行为写明（建议必填）。

### 4. 样式

- 新增 `src/styles/db.css`，并在 `src/styles.css` 的 `@import` 列表**末尾追加** `@import './styles/db.css';`（既有分区顺序一律不动）。
- 需要的规则（参照 `hermes.css` 与 `components.css` 的 `.pane--term`）：`.pane--db { padding: 0; overflow: hidden; }`、容器 `flex` 纵向铺满、iframe `width/height: 100%`、`border: 0`、窄屏才显示提示。
- 颜色/圆角/字号**一律走 antd 令牌**（`--ant-*`），**不得**新增自定义色板、不得新增字面色值（`npm run check:tokens` 会拦）。

### 5. `public/sw.js`

- `isNetworkOnly` 判定（现在约 165–171 行）**追加** `url.pathname.startsWith('/db/')`——DBGate 的请求一律直连网络，**绝不缓存**。
- 同时**提升版本常量** `CACHE_VERSION`（`'v2'` → `'v3'`），这是本仓库的硬约束（改缓存行为必须升版本）。
- **不要**把 `/db/` 任何资源加进 `PRECACHE_URLS`。

### 6. 文档（与本轮代码同笔交付）

- `docs/COMPONENTS.md`：登记新组件（组件 | 用途 | 关键 props/事件 | 最小示例 | 注意事项）。
- `AGENTS.md`：Tab 表追加一行「数据库 | `Database.tsx` | ...（说明：iframe 内嵌 `/db/`，同源、无二次登录）」，`src/components/` 目录树同步补。
- 文档里**只写相对路径与占位域名**，不得出现真实域名、公网 IP、内网地址。

## 三、明确不做的事

- 不改 `admin-server` / `blog-server` 任何代码，不新增后端接口。
- 不改 `src/api.ts` 的鉴权流程与全局 401 出口。
- 不新增任何 npm 依赖（`package.json` / `package-lock.json` 应无变化）。
- 不做账号打通、不做 iframe 内的登录态探测、不写自定义 loading 遮罩动画。
- 文案：唯美克制，**禁 emoji / 鸡汤 / 网络热词**，界面不写技术说明性文案。

## 四、交付标准（硬性，缺一不算完成）

1. `npm run check`（typecheck + lint + lint:css + check:tokens + test 聚合）退出码必须 0，报告里贴**原始输出**，不要转述。
2. 新增/改动的逻辑必须有对应单测；用例要满足"改坏了会红"。若确无纯逻辑可测（例如纯 JSX 与样式），必须在报告里**明确说明原因**，禁止写"函数存在"式假测试。
3. 【前端】必须维护 `docs/COMPONENTS.md` 组件登记表；新组件文件头写 TSDoc：
   - 登记表字段：组件 | 用途 | 关键 props/事件 | 最小示例 | 注意事项。
   - props/事件要有显式类型与默认值，不用 `any`；交互组件写可访问性要点（键盘/aria/焦点）。
   - 组件不得新造颜色/圆角/字号，一律走既有设计令牌（本项目 B 端 = antd 默认）。
   - 不引入 Storybook。
4. 注释与命名：导出符号必须有 TSDoc（用途/参数/返回/错误）；注释写"为什么"（取舍、兼容包袱、坑），不写"这行在做什么"；不留注释掉的死代码、不留 `console.log`/调试残留；不新增 TODO/FIXME。TS 走 strict，禁止 `any` 逃逸。禁止空 `catch`。
5. 源码里绝不硬编码真实域名 / 公网 IP / 内网地址 / 凭据；文档里同样只允许占位符（示例一律 `example.com`）。
6. 禁止"看起来对"的实现（假实现、空壳、占位 TODO）。做不到的点必须在报告里明说。
7. 报告四要素：改了什么 / 新增了哪些依赖 / 哪些没做到 / 留下什么风险；发现既有问题只报告不修。
8. **不要把需求文档本身写进源码或产物**。

## 五、提交纪律

- **小步多次提交**：每完成一个逻辑单元就 commit 一次，用 conventional commits（`feat:` / `test:` / `docs:` / `chore:`，一行摘要 + 必要时正文）。
- **禁止** `push`、禁止 `git checkout -b` 开分支、禁止 `rebase` / `reset --hard` / `merge`（历史只准往前走），一律在**当前分支**工作。
- 提交使用**当前仓库的 git 身份**，不得自报署名，不得写 `Co-authored-by` / `Generated-by` 之类水印。

## 六、自检与验收（机器可判，逐条贴原始输出）

```bash
npm run check; echo "CHECK_EXIT=$?"
npx vite build --outDir /tmp/admin-web-verify --emptyOutDir
grep -rl "/db/" /tmp/admin-web-verify/assets | head          # 产物里能搜到 iframe 目标路径
grep -n "'db'" src/components/Main.tsx
grep -n "数据库" src/components/Main.tsx src/components/Database.tsx
grep -n "打开数据库" src/components/CommandPalette.tsx
grep -n "startsWith('/db/')" public/sw.js
grep -n "CACHE_VERSION = 'v3'" public/sw.js
grep -c '^| ' docs/COMPONENTS.md                              # 登记表条数与组件数对得上
git status --short
```

**禁止**用 `npm run build` 验证（`vite.config.ts` 的 `outDir` 直写生产目录 `/var/www/admin` 且 `emptyOutDir`，会把线上清空重建）——验证构建**必须**带 `--outDir /tmp/...`。

隐私自检（工作区应为 0 命中；把下面尖括号占位换成实际关键字后执行）：

```bash
grep -rnE "<站点域名关键字>|<公网网段>|<邮箱域名>|sk-[A-Za-z0-9]{20,}" src public docs AGENTS.md
```

## 七、边界说明

- 「打开即已登录、直接可连」由**服务端**保证（DBGate 关闭自身登录 + 预置连接凭据 + 前置网关鉴权）。前端只要嵌对路径，**不要**试图在 iframe 里注入任何凭据或 token。
- 会话过期时 iframe 内会显示登录页，本轮**不做**特殊处理（用户刷新即可）。
- 本地没有 MySQL 服务，DBGate 里预置的是**云端 MySQL**；前端不需要关心连接来源。
