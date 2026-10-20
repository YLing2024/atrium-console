# admin-web 组件文档

> 本仓库为 **B 端管理后台**，设计语言一律走 **antd 默认 token**（颜色 / 圆角 / 字体用 antd 自带，
> 不映射自建调色板；纯 CSS 用 cssVar 模式的 `--ant-*` 变量）。
>
> 规则（见 `/root/proj/ENGINEERING_BASELINE.md` §11）：每个可复用组件在文件头写 TSDoc（用途 / props 与
> 事件含义 + 类型 + 默认值 / 使用要点 / 注意事项），并在本表登记一行；**新增组件必须同一笔登记**。
> 不引入 Storybook。
>
> 下表覆盖本仓库的全部组件（含本轮改动的 `System` 及其文件内子组件）。文件内子组件不跨文件复用，
> 但同样按组件对待（有 TSDoc、无可访问性副作用）。

| 组件 | 用途 | 关键 props / 事件 | 最小示例 | 注意事项 |
|---|---|---|---|---|
| `System` | 「系统」Tab 面板：实时系统指标（SSE）、磁盘/网络趋势图、全量进程树 | `active: boolean`（必填，无默认）——该 Tab 是否激活；无对外事件 | `<System active={tab === 'system'} />` | 面板在 `Main` 里常驻挂载（仅切换显隐），取数由 `active` 控制；进程树仅激活时每 5s 取样。进程内存拆两列「内存（含子进程）」（`subtree_mem_mb`）与「自身」（`mem_mb`），各自可排；工具条「含线程」开关默认关闭，开启后在进程名后显示 `thread_count`。 |
| `SystemInfo` | 「系统信息」区块：概要行 + 内存/磁盘/端口服务三卡（点击开 Drawer）+ Top 进程表 + 失败单元 + 最近登录 | `active: boolean`（必填，无默认）——系统 Tab 是否激活；无对外事件 | `<SystemInfo active={active} />` | 静态概况 60s、Top 进程 10s 刷新；`document.hidden` 时停表并中止在途请求，回前台立即拉一次（不会叠加定时器）。三张卡片可点击/Enter/Space 打开 Drawer，移动端纵向堆叠、表格横向滚动。各区块失败只显示自己的提示，不清空其它内容。 |
| `LoadStall` | 「负载与卡顿」区块：卡顿指数 + 档位 Tag + PSI 说明 + CPU 三档条（1s/15s/60s）+ Top 服务表 + 最近 15 秒 CPU 增量归因 | `active: boolean`（必填，无默认）——系统 Tab 是否激活；`data?: SystemData \| null`——系统 SSE 的 `system` 段 | `<LoadStall active={active} data={data} />` | 自身不发请求，数据全部复用 SSE；`stall_score` / `stall_level` 缺失（旧后端）时整块返回 `null`，子表为空只隐藏对应小节。已退出进程用灰 Tag「已退出」，增量表标题固定为「最近 15 秒 CPU 增量」。三档条与两张表在 390px 下纵向堆叠，表格横向滚动。 |
| `TrendChart`（System.tsx 内） | ECharts 折线趋势图（秒/分/时/天档共用） | `data: HistoryPoint[]`；`series: ChartSeries[]`；`yMax?: number`；`yLabel?: string`；`granularity: string`；`chartId: string`；`recordedMinutes?: number \| null`；`onReady` 由内部处理 | `<TrendChart data={trend} series={memSeries} yMax={100} yLabel="%" granularity={granularity} chartId="mem" />` | `Chart`（echarts）为动态 import，仅本面板引入；秒档 <2 点、其它档为空时显示占位文案；平移位置按档位记忆在内存。 |
| `Legend`（System.tsx 内） | 趋势图例：色块 + 名称 + 最新值 | `series: ChartSeries[]`；`data: HistoryPoint[]` | `<Legend series={memSeries} data={trend} />` | 颜色必须来自 `series[].color`（antd token 解析结果），不写死色值。 |
| `Bar`（System.tsx 内） | 进度条（CPU / 内存 / 磁盘共用） | `percent?: number \| null`（默认按 0）；`color: string` | `<Bar percent={memory.percent} color={barColor(memory.percent)} />` | 百分比自动钳制到 0–100；颜色由调用方按 `barColor`（`toneFor` 分级）给出。 |
| `CoreGrid`（System.tsx 内） | 每核占用区块 | `cores?: CoreUsage[]`；`colorOf: (p: number) => string` | `<CoreGrid cores={cpu.per_core} colorOf={barColor} />` | `cores` 缺失或空数组时整块不渲染（兼容旧后端）。 |
| `DiskCard`（System.tsx 内） | 单块磁盘卡片 | `title: string`；`disk: DiskInfo`；`colorOf: (p: number) => string` | `<DiskCard title="磁盘 /" disk={d} colorOf={barColor} />` | 多盘列表与旧单盘回退共用同一结构。 |
| `InfoRow`（System.tsx 内） | 键值详情行 | `k: ReactNode`；`v: ReactNode`；`valueStyle?: CSSProperties` | `<InfoRow k="可用" v={fmtBytes(memory.available)} />` | 值可换行；颜色走 `token.*`，不写死色值。 |
| `PsiRow`（System.tsx 内） | PSI 压力行（some/full 的 avg10） | `k: string`；`o?: PsiInfo \| null`；`danger: string`；`warn: string` | `<PsiRow k="内存" o={psi.memory} danger={token.colorError} warn={token.colorWarning} />` | 无 PSI 数据时显示「—」；阈值 some≥50 用 `danger`、≥30 用 `warn`。 |
| `Database` | 「数据库」Tab 面板：iframe 同源内嵌 DBGate（`/db/`），打开即用、无二次登录 | `active: boolean`（必填，无默认值）——该 Tab 是否激活；无对外事件 | `<Database active={tab === 'db'} />` | 面板在 `Main` 里常驻挂载（仅切显隐），故等 `active` 首次为 `true` 才渲染 iframe 并保持挂载（切走不卸载，避免丢失正在浏览的表 / 查询状态）；`src` 用同源相对路径 `/db/`，与终端 `/term/` 同一套接线，鉴权由前置网关负责，组件不碰凭据 / token。 |
| `SshKeys` | 「SSH 公钥」Tab 面板：公钥白名单的列表 / 新增 / 改标题 / 停用 / 删除 | 无 props；无对外事件——所有操作直接调用 `src/api.ts` 并重新拉取列表 | `<SshKeys />` | 面板在 `Main` 里常驻挂载（仅切显隐）。公钥只接受 `type base64 [comment]` 单行纯公钥，前端校验只是体验，服务端会再次解析并拒绝 `command=` 等前置选项；停用与删除的确认文案必须保留「已建立的连接不受影响」的区分。指纹用 antd `Typography.Text code` + `copyable`，移动端靠表格横向滚动与 `responsive` 列保留全部信息。 |
| `Tools` | 「工具」导航页：按 `GET /api/admin/tools` 列出工具入口（当前含 Bitwarden），整行点击进入 `/tools/<id>` | `active: boolean`（必填，无默认）——该 Tab 是否激活；无对外事件，`active` 首次为 `true` 时拉取清单 | `<Tools active={tab === 'tools'} />` | **只做入口，不渲染任何输入框**；密码只在独立工具页出现。未登记到 `TOOL_ENTRIES` 的工具不展示。面板在 `Main` 里常驻挂载，但隐藏时不发请求；返回列表会重新拉取以刷新状态。列表行原生可键盘聚焦（`Enter` / `Space` 进入）。 |
| `ToolBitwarden`（`src/pages/ToolBitwarden.tsx`） | `/tools/bitwarden` 独立解锁页：主密码换 session、显示剩余有效期、清除会话 | 无 props；路由固定为 `/tools/bitwarden`，页面内「‹ 工具」返回 `/tools` | `<ToolBitwarden />`（由 `Main` 在 `route.tool === 'bitwarden'` 时挂载） | 可直接打开 / 刷新 / 收藏，不依赖先经过导航页；离开页面即卸载，输入状态随之丢弃。密码只放组件 state，提交后立即清空，不写 localStorage / sessionStorage / URL；失败时同样清空输入。服务端 401 是「密码错误」而非会话失效，由 `src/api.ts` 的 `unauthorizedAsBusinessError` 区分。未配置时禁用表单并提示「未配置 BITWARDEN_*」；`autoComplete="off"`。 |
| `Terminal` | 「终端」Tab 面板：多标签 ttyd + tmux 终端；站点登录之外的口令门换 12h 票据，票据随 iframe 传给服务端 wrapper 校验 | `active: boolean`（必填，无默认值）——该 Tab 是否激活；无对外事件 | `<Terminal active={tab === 'term'} />` | 面板在 `Main` 里常驻挂载（仅切显隐）。进入流程前探测 `GET /api/admin/term/mode`：`unlockRequired === false`（后端 `ADMIN_TERM_UNLOCK=off`）时跳过口令表单直接取票，另外两条路径（口令表单 / 探测失败）均按需要口令兜底，判定见 `src/termGate.ts`。票据存 `sessionStorage`、多标签、6s 存活点轮询、`pagehide` sendBeacon 关窗断连一律保持既有行为。 |

## 可访问性要点

- `SystemInfo` 的三张小编卡片是 `role="button"` + `tabIndex=0`，支持 `Enter` / `Space` 打开 Drawer；
  卡片标题与 `aria-label` 同名，明细内容在 Drawer 内是普通文本 / 表格，不依赖悬停。失败单元用 `Tag`
  展示的同时保留文字「无失败单元」空态，颜色不是唯一语义。
- `LoadStall` 的档位 Tag 与 PSI 状态点都同时带文字（「顺畅 / 有压力 / 明显卡顿」与百分比），
  不靠颜色单独传意；CPU 三档条的 `title` 提供悬停具体值，旁边也常驻同值文本。
- `System` 的进程表用的是 antd `Table` 的树形展开：展开/折叠图标可键盘聚焦、`Enter`/`Space` 触发，
  收展状态由 `expandedRowKeys` 受控（拿到第一份进程数据后一次性展开全部，用户手动折叠的选择在 5s
  轮询刷新间保留）。不要退回 `defaultExpandAllRows`（数据异步到达时不生效）。
- 进程表工具条「含线程」用 antd `Switch`（`role="switch"`，可 `Tab` 聚焦、`Enter`/`Space` 切换），
  旁附文字标签「含线程」；开关状态只影响进程列文案，不改变任何数值口径。
- 表内数值（内存 / CPU / 进程数）为纯文本，深浅主题对比度由 antd `Table` 默认 token 保证；
  次要文字用 `Typography.Text type="secondary"`（`--ant-color-text-secondary`）。
- 趋势图为 canvas 渲染（ECharts）：`aria` 支持有限，图表旁一律保留同名 `Legend` 文本摘要作为等价信息。
- 状态点（`Badge`）不承载唯一语义：`services` 里的状态在 `Manage` 等页面另有文字表达，避免只靠颜色传意。
- Bitwarden 的状态同时用 `Tag` 与「状态：…」文字表达（导航列表为「已锁定 / 已解锁」+ 剩余时间）；密码框
  有 `aria-label="主密码"`，可用键盘 `Tab` 聚焦、`Enter` 提交表单，未配置或请求进行中时表单控件禁用。

## 相关纯函数模块（非组件）

| 模块 | 用途 | 说明 |
|---|---|---|
| `src/procTree.ts` | 进程树组树 / 排序 / 收集展开键 | 纯函数：`buildProcTree`（防环）、`sortProcTree`（排序键 `name`/`mem` 含子进程合计/`own` 自身/`cpu`）、`collectProcPids`（一次性展开键）、`procSortCompare`。子树字段沿用后端返回值，前端不自己数。 |
| `src/format.ts` | 数值 / 时间 / 体积格式化 | `fmtMB` / `fmtBytes` / `fmtRate` / `fmtDuration` / `toneFor` 等，纯函数。 |
| `src/dbTab.ts` | 数据库 Tab 的首次激活粘滞标记 | `latchActivated(activated, active)`：一旦为 `true` 便保持 `true`，纯函数。 |
| `src/termGate.ts` | 终端口令门模式判定 | `unlockRequiredOf(data)`：仅显式 `unlockRequired === false` 返回 `false`，缺字段 / 非布尔 / 非对象（探测失败）一律 `true`，纯函数。 |
| `src/router.ts` | 极简前端路由 | 原生 History API，零依赖：`parseRoute(pathname)` / `routePath(section, tool?)` 为纯函数，`readRoute` / `navigate` / `subscribe` 操作地址栏与 `popstate`；`/` 与未知路径用 `replaceState` 归一到 `/system`。 |
| `src/toolStatus.ts` | Bitwarden 剩余有效期计算 | `remainingFromExpiresAt(expiresAt, now?)` 由 epoch 毫秒推剩余秒数（过去钳制为 0），纯函数；状态文案 `bitwardenStatusText` 在 `src/format.ts`。 |
