# admin-web：改用 Ant Design + ECharts 的需求书

> 本文是本次改造的唯一依据。分四轮执行，**每轮只做本轮范围内的东西**，做完自检、小步提交、写报告。
> 文档与仓库现实冲突时（组件/工具函数/令牌已存在、命名不同）**以仓库现实为准，直接实现，不要提问**。

## 1. 目标

- 用 **Ant Design 5**（`antd`）替换现有手写组件与大部分手写 CSS，统一交互与外观。
- 图表用 **ECharts** 替换 `System.tsx` 里自绘的 SVG 折线图。
- **功能行为不变**：接口、路由、鉴权流程、文案、PWA 行为、终端 iframe、Markdown 编辑器一律照旧。
- 视觉不追求"antd 默认脸"：主题令牌对齐本仓库既有设计系统（暖纸白 / 墨黑 / 琥珀，直角，发丝线，动效 ≤150ms）。

## 2. 现状（改造前）

| 项 | 值 |
|---|---|
| 栈 | React 18 + Vite 5 + TypeScript strict |
| 依赖 | `react` `react-dom` `marked` `dompurify` `qrcode` `codemirror` 系列 |
| 样式 | 手写 CSS，入口 `src/styles.css`（只 `@import`），分区在 `src/styles/`（20 个文件） |
| 设计令牌 | 6 个核心令牌 `--bg --surface --fg --muted --line --accent`，深浅两套，由 `scripts/check-tokens.mjs` 与基准表逐值校验 |
| 校验 | `npm run check` = `typecheck` + `lint` + `lint:css` + `check:tokens` + `test`（node:test 纯函数单测） |
| e2e | `e2e/`（独立 package.json）：`apps-check.cjs`、`sidebar-check.cjs`，用了 `.sidenav-item` 等选择器 |
| 构建 | `vite.config.ts` 里 `outDir: process.env.BUILD_OUT_DIR || '/var/www/admin'`，`emptyOutDir: true` |
| 入口 | `index.html`（后台）+ `public.html`（公开应用中心，多入口） |

组件规模（行数）：`BlogAdmin 959` / `System 854` / `Manage 685` / `Files 652` / `FileShare 547` /
`NotificationCenter 474` / `MarkdownEditor 415` / `NotificationManage 403` / `Terminal 339` /
`NotificationDebug 311` / `Main 265` / `ResetTotp 168` / `LoginPage 158` / `Apps 130` /
`PublicApps 111` / `CommandPalette 111` / `AppCard 59`。

## 3. 技术约定

### 3.1 依赖

```
npm i antd @ant-design/icons echarts
```

- 用登录 shell 的 node 装即可（纯 JS 包，无原生模块）；装完 `npm run check` 必须仍然全绿。
- **不引入** `echarts-for-react`、`@ant-design/pro-*`、`@ant-design/charts`、tailwind、styled-components 等额外包。
- ECharts **按需注册**，禁止 `import * as echarts from 'echarts'` 全量引入：

```ts
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, CanvasRenderer]);
```

### 3.2 主题映射（`ConfigProvider`）

在 `src/main.tsx`（后台入口）外层包 `ConfigProvider`，中文语言包 `zhCN`，并把本仓库设计令牌映射到 antd token。
**深浅色必须跟随现有 `src/theme.ts`（localStorage `admin_theme`）**，切换时同步 antd 主题。

浅色：`algorithm: theme.defaultAlgorithm`

| antd token | 值 |
|---|---|
| `colorPrimary` | `#a05b0c` |
| `colorBgBase` / `colorBgLayout` | `#f7f6f3` |
| `colorBgContainer` | `#fbfaf8` |
| `colorText` | `#171512` |
| `colorTextSecondary` / `colorTextTertiary` | `#6f6a63` |
| `colorBorder` / `colorBorderSecondary` | `rgba(23,21,18,0.16)` |
| `borderRadius` `borderRadiusLG` `borderRadiusSM` `borderRadiusXS` | `0` |
| `fontFamily` | `'Inter Tight', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| `fontSize` | `14` |
| `controlHeight` | `32` |
| `motionDurationFast` / `motionDurationMid` / `motionDurationSlow` | `0.1s` / `0.15s` / `0.15s` |
| `wireframe` | `false` |
| `cssVar` | `true`（开启 CSS 变量模式，减少运行时样式抖动） |

深色：`algorithm: theme.darkAlgorithm`，并把 `colorPrimary` 换成 `#c77c1f`、
`colorBgBase/colorBgLayout` 换成 `#13110f`、`colorBgContainer` 换成 `#191715`、
`colorText` 换成 `#efeae3`、`colorTextSecondary` 换成 `#a29b92`、`colorBorder/Secondary` 换成 `rgba(239,234,227,0.16)`。

补充约定：

- 令牌**只改 antd token 层，不改 CSS 里的令牌定义**——`scripts/check-tokens.mjs` 必须继续通过（那 6 个令牌仍是唯一基准）。
- 直角是硬要求：所有圆角令牌为 `0`；不要手动覆盖成 antd 默认的 6px/8px。
- 文案仍然克制：**禁 emoji、禁技术说明性文案**；不要在 UI 上写"Powered by Ant Design"之类。
- 图标用 `@ant-design/icons`；**应用卡片里的 31 个应用图标（`AppIcon.tsx` 的内联 SVG）保持不动**，它们不是 UI 图标。

### 3.3 ECharts 封装

新增 `src/components/Chart.tsx`（本项目唯一图表入口）：

- props：`option`（EChartsOption）、`height`、`className`、`loading`（显示"数据采集中…"占位时用）、`onReady?`
- 责任：`echarts.init` / `setOption(option, { notMerge: true })` / `ResizeObserver` 自适应 / 卸载 `dispose()` /
  **主题变化时重新 init**（浅深色切换，颜色从 CSS 变量读，不要写死颜色）
- 只暴露这一个封装，禁止在业务组件里直接 `echarts.init`。

### 3.4 响应式与移动端（硬要求）

- 窄屏**不能隐藏导航**：侧栏在窄屏（`< 900px`）改由 **antd `Drawer`**（从右侧滑出）承载，顶栏放"目录"按钮触发；
  抽屉不放在正文开头。桌面端用 `Layout.Sider` 常驻。
- 正文不得出现横向滚动条（图表、表格要在自身容器内处理溢出）。
- 表格在窄屏可横向滚动，但**操作列不换行**。

## 4. 红线（不许动）

1. **`src/api.ts` 的鉴权流程**：认证模式探测、401 全局出口、会话 cookie 语义一律不动（只能追加纯辅助函数）。
2. **`src/siteUrl.ts`**：公共站点链接唯一拼接入口，不得改语义；不得写相对路径跳公共站。
3. **`Terminal.tsx` 的 ttyd 细节**：`--url-arg` 顺序（会话名 + 票据）、6s 存活轮询、`sendBeacon` 断开语义、
   刷新保留会话——只允许**换外壳样式**，逻辑一行都不许改。
4. **`MarkdownEditor.tsx`（CodeMirror 6）**：编辑器内核不动，只允许调整外层容器与工具栏到 antd 风格。
5. **PWA 相关文件与行为**（`public/sw.js`、`manifest.webmanifest`、`offline.html`、`src/pwa.ts`、
   `App.tsx` 的离线判定）：缓存策略、版本常量、注册方式不变；确实需要动 `sw.js` 时必须同步提升版本常量。
6. **`public.html` → `PublicApps.tsx` → `AppCard.tsx` 这条公开路径**：公开页保持轻量，
   **不得引入 antd/ECharts**（首屏体积），只允许沿用既有手写样式；`AppCard` 的类名与渲染结构不得改。
   后台的「应用」Tab 可以把它包在 antd 容器里，但不要改 `AppCard` 自身。
7. **隐私**：源码里不得出现真实域名 / 私有 IP / 私有路径 / 密钥；示例一律 `example.com`。
   `VITE_*` 环境变量注入方式不变，只提交 `.env.example`。
8. **不得运行**：`systemctl` / `service` / `kill` / `pkill` / `fuser -k`；不得操作本仓库以外的路径。
   每条命令自带 `timeout`，失败不要死循环重试。
9. **不得 `git push`**、不得 `git checkout -b` 开分支、不得 `rebase` / `reset --hard` / `merge`。
10. **构建输出**：任何构建都必须显式指定独立输出目录，**绝不允许**默认 outDir 覆盖生产目录：
    `BUILD_OUT_DIR=/tmp/admin-web-verify npx vite build --emptyOutDir`

## 5. 分轮任务

### 第 1 轮：依赖 + 主题 + 外壳

范围：

1. 装依赖（见 3.1）。
2. `src/main.tsx`：包 `ConfigProvider`（`zhCN` + 令牌映射 + 深浅色跟随 `theme.ts`），业务里通过 antd `App`
   组件使用 `message`/`notification`（不要再用自绘 toast）。
3. `src/components/Main.tsx` + `src/styles/layout.css`：
   - 整体换 `Layout`（`Sider` 常驻 / 窄屏 `Drawer` 右侧滑出 + 顶栏"目录"按钮 + 点击遮罩关闭）。
   - 侧栏菜单用 `Menu`（保持现有 Tab 顺序与 id、`sessionStorage.admin_tab` 白名单逻辑与默认 `system` 不变），
     未读徽标用 `Badge`。
   - 用户菜单用 `Dropdown`（保留"登出"等现有条目与行为），去掉手写 `.user-dropdown`、`.sidenav-*` 死代码。
   - 顶栏保留现有元素（主题切换、刷新、用户入口），图标换 `@ant-design/icons`。
4. `src/components/LoginPage.tsx`：换 `Form` + `Input` + `Button` + `Alert`；
   builtin 模式的动态码输入、错误映射、加载态行为与文案保持一字不差。
5. `src/components/CommandPalette.tsx`：换 antd `Modal` + `Input` + `List`，键盘操作（上下选择、回车执行、Esc 关闭）不变。
6. 同步 `e2e/sidebar-check.cjs`、`e2e/apps-check.cjs` 里被改动的选择器（导航从 `.sidenav-item` 改到什么就更新成什么）。

验收：

```bash
npm run check                                   # 五项全绿
BUILD_OUT_DIR=/tmp/admin-web-verify npx vite build --emptyOutDir   # 构建通过
grep -rn "sidenav-backdrop\|user-dropdown" src/ | wc -l            # 应为 0（死代码已清）
```

提交切分（参考）：`chore(deps): add antd and echarts`、`feat(theme): map design tokens to antd theme`、
`refactor(layout): rebuild shell with antd layout`、`refactor(login): use antd form`、
`refactor(command-palette): use antd modal`、`test(e2e): update selectors`。

### 第 2 轮：博客与系统管理面板

范围（只做这些文件，其它不动）：

- `BlogAdmin.tsx`：表格 `Table`（分页/排序/选择）、表单 `Form` + `Input`/`Select`/`Switch`、
  弹窗 `Modal`、确认 `Popconfirm`、状态 `Tag`、通知用 antd `message`。
  **注意**：文章表单里的「副标题（`subtitle`）」独立字段、雪花 ID（`public_id`）只读展示、
  草稿自动保存与恢复(`${localStorage}` 的 `blog_draft_new`) 的现有语义一律不变。
- `Manage.tsx`：服务状态、API Token、TOTP 重置三块换 `Table` / `Card` / `Modal` / `Form`；
  TOTP 二维码用 `qrcode` 既有实现，只换容器（要换成 antd `QRCode` 需先确认与 `qrcode` 输出一致，否则保持）。
- `ResetTotp.tsx`、`VersionPanel.tsx`：换 `Form` / `Descriptions` / `Table` / `Card`。
- `NotificationCenter.tsx`、`NotificationManage.tsx`、`NotificationDebug.tsx`：换
  `List`/`Table`/`Tag`/`Badge`/`Drawer`/`Form`/`Switch`；接口路径、轮询间隔、未读计数语义不变。

验收：

```bash
npm run check
BUILD_OUT_DIR=/tmp/admin-web-verify npx vite build --emptyOutDir
grep -rn "useState(false)" src/components/BlogAdmin.tsx >/dev/null; echo "只做形式检查"
```

### 第 3 轮：文件区与分享

范围：

- `Files.tsx`：上传换 `Upload.Dragger`（保留**多文件、目录拖拽、进度条、失败提示**），
  列表换 `Table`（名称/大小/时间/操作），新建/重命名用 `Modal` + `Form`，删除用 `Popconfirm`，
  面包屑用 `Breadcrumb`，工具栏用 `Space` + `Button`。
  **`/data` 相关行为、路径穿越防护、软链跳过、受保护路径的只读语义一律不变。**
- `FileShare.tsx`：链接列表换 `Table`，创建用 `Modal`（保留有效期选择与默认值）、
  复制链接、撤销用 `Popconfirm`；`expiresAt` 单位（毫秒 epoch，`0`＝永久）语义不变。
- 相关手写 CSS 死代码清理（`styles/` 下这些面板的部分），保证 `npm run lint:css` 通过。

验收：

```bash
npm run check
BUILD_OUT_DIR=/tmp/admin-web-verify npx vite build --emptyOutDir
```

### 第 4 轮：图表（ECharts）与应用面板

范围：

- 新增 `src/components/Chart.tsx`（见 3.3）。
- `System.tsx`：把自绘 SVG 折线图整体换成 ECharts 折线图。必须保留的行为：
  - 现有指标（CPU / 内存 / 磁盘 / 网络收发）与各自单位、颜色语义；
  - 粒度切换（现有 granularity 选项）与"数据采集中…"占位；
  - **平移与"回最新"**：改用 ECharts `dataZoom`（`type: 'inside'`，触屏与滚轮都能拖），
    "回最新"按钮语义不变（复位到最新并恢复跟随）；
  - **每个图的视图记忆**（现有 `chartViewMemory`：按 `granularity + chartId` 记住 offset/follow）保持等价；
  - **触屏可用**（Pointer/触摸拖动），不得只绑 mouse 事件；
  - 横向不得溢出容器、不得出现无意义滚动条；
  - **不要把"回最新"按钮做成会被拖动层吞掉 click 的写法**（不要用 `setPointerCapture` 捕获整块图表容器）。
- `Apps.tsx`：卡片网格换 antd `Row/Col` + 卡片容器 + 状态 `Badge`/`Tag`（状态语义：正常/需登录/响应慢/
  异常/休眠/未知，**`idle` 文案仍是"休眠"、不计入异常**）；30s 自动刷新与 `/api/admin/apps` 不变。
  `AppCard.tsx` 本体不动（公开页共用）。

验收：

```bash
npm run check
BUILD_OUT_DIR=/tmp/admin-web-verify npx vite build --emptyOutDir
node -e "const s=require('fs').readFileSync('/tmp/admin-web-verify/assets/'+require('fs').readdirSync('/tmp/admin-web-verify/assets').find(f=>f.endsWith('.js')));console.log('bundle 含 echarts:', /echarts|dataZoom/.test(s))"
```

## 6. 提交纪律

- **就在当前分支工作**，每完成一个逻辑单元就 `git commit`（小步多次），消息用 conventional commits
  （`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`，一行摘要，必要时正文）。
- 提交用当前仓库 git 身份，**不得**出现任何工具/代理署名、`Co-authored-by`、`Generated-by` 之类水印；
  文档与代码注释里不得出现"编码代理""AI""本任务编号"等字样。
- **禁止** `git push`、`git checkout -b`、`rebase`、`reset --hard`、`merge`。
- 每轮结束把**本轮报告**写入 `/tmp/admin-web-roundN-report.md`（改了哪些文件、每笔提交、
  执行了哪些命令与结果、遗留问题），然后 `cat` 出来。

## 7. 总验收（每轮都要过）

```bash
npm run check                                                      # typecheck + lint + lint:css + check:tokens + test
BUILD_OUT_DIR=/tmp/admin-web-verify npx vite build --emptyOutDir    # 构建通过、无告警级错误
git status --porcelain                                              # 应为空（改动都已提交）
git log --oneline -8                                               # 能看到本轮的多次提交
grep -rnE "zhangyunling|223\.254|24\.233|sk-[A-Za-z0-9]{10,}" src/ public/ *.ts *.tsx *.md | wc -l   # 应为 0
```

## 8. 完成后回写

- 更新 `AGENTS.md`：把"样式：手写 CSS"改成"Ant Design 组件 + 设计令牌",补充 ECharts 图表约定与
  `Chart.tsx` 入口、公开页不引 antd 的约束；把已失效的旧约定删掉（不要留"已废弃"堆积）。
- 更新 `PROJECT_MEMORY.md`：记录主题映射位置、`Chart.tsx` 契约、e2e 选择器变化、
  以及任何被推翻的旧结论。
