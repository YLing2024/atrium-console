# admin-web 组件文档

> 本仓库为 **B 端管理后台**，设计语言一律走 **antd 默认 token**（颜色 / 圆角 / 字体用 antd 自带，
> 不映射自建调色板；纯 CSS 用 cssVar 模式的 `--ant-*` 变量）。
>
> 规则（见 `/root/proj/ENGINEERING_BASELINE.md` §11）：每个可复用组件在文件头写 TSDoc（用途 / props 与
> 事件含义 + 类型 + 默认值 / 使用要点 / 注意事项），并在本表登记一行；**新增组件必须同一笔登记**。
> 不引入 Storybook。
>
> 下表覆盖本仓库的全部组件（含监控页拆出的 KPI / 趋势 / 压力 / Top 表 / 审计组件）。
> 文件内子组件不跨文件复用，但同样按组件对待（有 TSDoc、无可访问性副作用）。

| 组件 | 用途 | 关键 props / 事件 | 最小示例 | 注意事项 |
|---|---|---|---|---|
| `System` | 「系统」Tab 面板：监控总览（5 张 KPI + 主趋势 + PSI + Top 表 + 告警审计） | `active: boolean`（必填，无默认）——该 Tab 是否激活；无对外事件 | `<System active={tab === 'system'} />` | 面板在 `Main` 里常驻挂载（仅切换显隐），取数由 `active` 控制。SSE 提供实时指标 / PSI / 卡顿指数 / Top 服务；`/api/admin/services` 每 5s 提供进程；`/api/admin/system/info` 每 60s 提供失败单元 / 登录 / 端口；主趋势按 `1h/6h/24h/7d` 请求 metrics。页面隐藏时进程与概况轮询停表。 |
| `KpiCard`（`MonitorKpi.tsx`） | KPI 卡：标签 + 28px 数字 + 副行 + 40×28 迷你趋势 | `label: string`；`value: string`；`detail: ReactNode`；`spark: (number \| null \| undefined)[]`；`tone?: 'normal' \| 'warning' \| 'error'`（默认 `normal`） | `<KpiCard label="CPU" value="16.4%" detail="15s 14.3% · 60s 16.0%" spark={sparkCpu} />` | 卡片必须放在 `.monitor-kpis` 网格里才能等高；`value` 的展示文本由调用方格式化，无数据传 `—`，不要传 `0`。超过阈值时只换 sparkline 颜色，不改变数字语义。 |
| `Sparkline`（`MonitorKpi.tsx`） | 40×28 极简 SVG 折线：无轴 / 无网格 / 8% 渐变填充 | `values: (number \| null \| undefined)[]`；`color: string`；`width?: number`（默认 40）；`height?: number`（默认 28） | `<Sparkline values={[12, 15, 90]} color={token.colorPrimary} />` | 空值跳过；单点画圆点；无有效点保留空白。图形 `aria-hidden`，语义由 KPI 正文承担。 |
| `MonitorTrend`（`MonitorTrend.tsx`） | 主趋势卡：CPU 左轴 + 内存右轴、面积渐变、inside dataZoom、1h/6h/24h/7d 切换 | `range: MonitorRange`；`onRangeChange: (r: MonitorRange) => void`；`points: HistoryPoint[]`；`loading: boolean` | `<MonitorTrend range={range} onRangeChange={setRange} points={trendPoints} loading={trendLoading} />` | 数据由父级请求；`Chart` 仍为动态 import，暗色由 `Chart` 订阅 `subscribeTheme` 重建。空点集显示 `—`，不显示 0。刻度固定约 5 个，避免 1440 点时横轴拥挤。 |
| `MonitorPressure`（`MonitorPressure.tsx`） | 右侧 PSI 三条压力条（some avg60）+ 1m/5m/15m 负载 | `data?: SystemData \| null` | `<MonitorPressure data={data} />` | 阈值固定：<20 主色、20–50 warning、>50 error；数值保留 2 位小数并常驻条右侧。缺 PSI 时条宽 0、数值 `—`。 |
| `TopProcesses` / `TopServices`（`MonitorTables.tsx`） | 中部两张 Top 表：进程（名称/PID/CPU/内存/线程/cgroup）与服务（单元/CPU/内存） | `TopProcesses: { processes: ProcessInfo[] }`；`TopServices: { services: ServiceCpu[] }` | `<TopProcesses processes={processes} />`、`<TopServices services={data.top_services ?? []} />` | 都按 CPU 降序取前 8 行；窄屏表格在卡片内横滑，不撑破页面。空态统一 `—`。 |
| `MonitorAudit`（`MonitorAudit.tsx`） | 底部三块并排：失败单元 / 最近登录 / 端口服务 | `info: SystemInfoResponse \| null`；`error?: string` | `<MonitorAudit info={info} error={infoError} />` | 失败单元为 0 不显示红色；登录 / 端口采集失败降级为灰色说明；概况未到达时显示 `—`。三块窄屏纵向堆叠，桌面等宽。 |
| `Database` | 「数据库」Tab 面板：iframe 同源内嵌 DBGate（`/db/`），打开即用、无二次登录 | `active: boolean`（必填，无默认值）——该 Tab 是否激活；无对外事件 | `<Database active={tab === 'db'} />` | 面板在 `Main` 里常驻挂载（仅切显隐），故等 `active` 首次为 `true` 才渲染 iframe 并保持挂载（切走不卸载，避免丢失正在浏览的表 / 查询状态）；`src` 用同源相对路径 `/db/`，与终端 `/term/` 同一套接线，鉴权由前置网关负责，组件不碰凭据 / token。 |
| `SshKeys` | 「SSH 公钥」Tab 面板：公钥白名单的列表 / 新增 / 改标题 / 停用 / 删除 | 无 props；无对外事件——所有操作直接调用 `src/api.ts` 并重新拉取列表 | `<SshKeys />` | 面板在 `Main` 里常驻挂载（仅切显隐）。公钥只接受 `type base64 [comment]` 单行纯公钥，前端校验只是体验，服务端会再次解析并拒绝 `command=` 等前置选项；停用与删除的确认文案必须保留「已建立的连接不受影响」的区分。指纹用 antd `Typography.Text code` + `copyable`，移动端靠表格横向滚动与 `responsive` 列保留全部信息。 |
| `Tools` | 「工具」导航页：按 `GET /api/admin/tools` 列出工具入口（当前含 Bitwarden），整行点击进入 `/tools/<id>` | `active: boolean`（必填，无默认）——该 Tab 是否激活；无对外事件，`active` 首次为 `true` 时拉取清单 | `<Tools active={tab === 'tools'} />` | **只做入口，不渲染任何输入框**；密码只在独立工具页出现。未登记到 `TOOL_ENTRIES` 的工具不展示。面板在 `Main` 里常驻挂载，但隐藏时不发请求；返回列表会重新拉取以刷新状态。列表行原生可键盘聚焦（`Enter` / `Space` 进入）。 |
| `ToolBitwarden`（`src/pages/ToolBitwarden.tsx`） | `/tools/bitwarden` 独立解锁页：主密码换 session、显示剩余有效期、清除会话 | 无 props；路由固定为 `/tools/bitwarden`，页面内「‹ 工具」返回 `/tools` | `<ToolBitwarden />`（由 `Main` 在 `route.tool === 'bitwarden'` 时挂载） | 可直接打开 / 刷新 / 收藏，不依赖先经过导航页；离开页面即卸载，输入状态随之丢弃。密码只放组件 state，提交后立即清空，不写 localStorage / sessionStorage / URL；失败时同样清空输入。服务端 401 是「密码错误」而非会话失效，由 `src/api.ts` 的 `unauthorizedAsBusinessError` 区分。未配置时禁用表单并提示「未配置 BITWARDEN_*」；`autoComplete="off"`。 |
| `Terminal` | 「终端」Tab 面板：多标签 ttyd + tmux 终端；站点登录之外的口令门换 12h 票据，票据随 iframe 传给服务端 wrapper 校验 | `active: boolean`（必填，无默认值）——该 Tab 是否激活；无对外事件 | `<Terminal active={tab === 'term'} />` | 面板在 `Main` 里常驻挂载（仅切显隐）。进入流程前探测 `GET /api/admin/term/mode`：`unlockRequired === false`（后端 `ADMIN_TERM_UNLOCK=off`）时跳过口令表单直接取票，另外两条路径（口令表单 / 探测失败）均按需要口令兜底，判定见 `src/termGate.ts`。票据存 `sessionStorage`、多标签、6s 存活点轮询、`pagehide` sendBeacon 关窗断连一律保持既有行为。 |

## 可访问性要点

- `System` 的“刷新”是普通 antd `Button`，可键盘聚焦；更新时间用 `toLocaleTimeString('zh-CN')` 常驻显示。
- `KpiCard` / `Sparkline` 的图形 `aria-hidden`，标签、数字与副行都是可读文本；卡顿指数的圆点旁永远有
  「顺畅 / 有压力 / 明显卡顿」文字，颜色不是唯一语义。无数据时显示 `—`，不把空态误读成 0。
- `MonitorTrend` 为 canvas 图表，`aria` 支持有限：工具栏保留 CPU / 内存色块与名称，卡片底部常驻
  峰值、均值、当前值文本作为等价摘要；空点集显示 `—` 而不是空白画布。
- `MonitorPressure` 的每条压力条是 `role="progressbar"`，带 `aria-valuemin` / `aria-valuemax` /
  `aria-valuenow` / `aria-valuetext`；键盘用户不需要悬停也能读到数值，颜色仅作辅助。
- `MonitorAudit` 的三块全部是文本 / 表格：失败单元为 0 时只显示中性数字「0」+「无失败单元」；
  采集失败用灰色说明文字，不用告警色常驻。端口与登录列表在窄屏纵向堆叠。
- `TopProcesses` / `TopServices` 使用 antd `Table`，表头与单元格数值继承默认 token；窄屏时表格容器
  横向滚动，页面本身不出现横向滚动条。
- Bitwarden 的状态同时用 `Tag` 与「状态：…」文字表达（导航列表为「已锁定 / 已解锁」+ 剩余时间）；密码框
  有 `aria-label="主密码"`，可用键盘 `Tab` 聚焦、`Enter` 提交表单，未配置或请求进行中时表单控件禁用。

## 相关纯函数模块（非组件）

| 模块 | 用途 | 说明 |
|---|---|---|
| `src/procTree.ts` | 进程树组树 / 排序 / 收集展开键 | 纯函数：`buildProcTree`（防环）、`sortProcTree`（排序键 `name`/`mem` 含子进程合计/`own` 自身/`cpu`）、`collectProcPids`（一次性展开键）、`procSortCompare`。子树字段沿用后端返回值，前端不自己数。 |
| `src/format.ts` | 数值 / 时间 / 体积格式化 | `fmtMB` / `fmtBytes` / `fmtRate` / `fmtDuration` / `toneFor` 等，纯函数。 |
| `src/monitor.ts` | 监控页阈值、时间范围与迷你趋势几何 | `monitorRangeSpec`（1h/6h/24h/7d → range/step/refreshMs）、`pressureTone`（<20 / 20–50 / >50）、`thresholdTone`、`buildSparkGeometry`（40×28 坐标映射）、`withAlpha`、`pickRootDisk`、`loadavgText`、`formatTrendTick`、`columnValues`；均有单测。 |
| `src/dbTab.ts` | 数据库 Tab 的首次激活粘滞标记 | `latchActivated(activated, active)`：一旦为 `true` 便保持 `true`，纯函数。 |
| `src/termGate.ts` | 终端口令门模式判定 | `unlockRequiredOf(data)`：仅显式 `unlockRequired === false` 返回 `false`，缺字段 / 非布尔 / 非对象（探测失败）一律 `true`，纯函数。 |
| `src/router.ts` | 极简前端路由 | 原生 History API，零依赖：`parseRoute(pathname)` / `routePath(section, tool?)` 为纯函数，`readRoute` / `navigate` / `subscribe` 操作地址栏与 `popstate`；`/` 与未知路径用 `replaceState` 归一到 `/system`。 |
| `src/toolStatus.ts` | Bitwarden 剩余有效期计算 | `remainingFromExpiresAt(expiresAt, now?)` 由 epoch 毫秒推剩余秒数（过去钳制为 0），纯函数；状态文案 `bitwardenStatusText` 在 `src/format.ts`。 |
