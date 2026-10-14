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
| `System` | 「系统」Tab 面板：实时系统指标（SSE）、磁盘/网络趋势图、全量进程树 | `active: boolean`（必填，无默认）——该 Tab 是否激活；无对外事件 | `<System active={tab === 'system'} />` | 面板在 `Main` 里常驻挂载（仅切换显隐），取数由 `active` 控制；进程树仅激活时每 5s 取样。进程内存列主显示「含子进程」合计、次要显示「自身」。 |
| `TrendChart`（System.tsx 内） | ECharts 折线趋势图（秒/分/时/天档共用） | `data: HistoryPoint[]`；`series: ChartSeries[]`；`yMax?: number`；`yLabel?: string`；`granularity: string`；`chartId: string`；`recordedMinutes?: number \| null`；`onReady` 由内部处理 | `<TrendChart data={trend} series={memSeries} yMax={100} yLabel="%" granularity={granularity} chartId="mem" />` | `Chart`（echarts）为动态 import，仅本面板引入；秒档 <2 点、其它档为空时显示占位文案；平移位置按档位记忆在内存。 |
| `Legend`（System.tsx 内） | 趋势图例：色块 + 名称 + 最新值 | `series: ChartSeries[]`；`data: HistoryPoint[]` | `<Legend series={memSeries} data={trend} />` | 颜色必须来自 `series[].color`（antd token 解析结果），不写死色值。 |
| `Bar`（System.tsx 内） | 进度条（CPU / 内存 / 磁盘共用） | `percent?: number \| null`（默认按 0）；`color: string` | `<Bar percent={memory.percent} color={barColor(memory.percent)} />` | 百分比自动钳制到 0–100；颜色由调用方按 `barColor`（`toneFor` 分级）给出。 |
| `CoreGrid`（System.tsx 内） | 每核占用区块 | `cores?: CoreUsage[]`；`colorOf: (p: number) => string` | `<CoreGrid cores={cpu.per_core} colorOf={barColor} />` | `cores` 缺失或空数组时整块不渲染（兼容旧后端）。 |
| `DiskCard`（System.tsx 内） | 单块磁盘卡片 | `title: string`；`disk: DiskInfo`；`colorOf: (p: number) => string` | `<DiskCard title="磁盘 /" disk={d} colorOf={barColor} />` | 多盘列表与旧单盘回退共用同一结构。 |
| `InfoRow`（System.tsx 内） | 键值详情行 | `k: ReactNode`；`v: ReactNode`；`valueStyle?: CSSProperties` | `<InfoRow k="可用" v={fmtBytes(memory.available)} />` | 值可换行；颜色走 `token.*`，不写死色值。 |
| `PsiRow`（System.tsx 内） | PSI 压力行（some/full 的 avg10） | `k: string`；`o?: PsiInfo \| null`；`danger: string`；`warn: string` | `<PsiRow k="内存" o={psi.memory} danger={token.colorError} warn={token.colorWarning} />` | 无 PSI 数据时显示「—」；阈值 some≥50 用 `danger`、≥30 用 `warn`。 |

## 可访问性要点

- `System` 的进程表用的是 antd `Table` 的树形展开：展开/折叠图标可键盘聚焦、`Enter`/`Space` 触发，
  收展状态由 `expandedRowKeys` 受控（拿到第一份进程数据后一次性展开全部，用户手动折叠的选择在 5s
  轮询刷新间保留）。不要退回 `defaultExpandAllRows`（数据异步到达时不生效）。
- 表内数值（内存 / CPU / 进程数）为纯文本，深浅主题对比度由 antd `Table` 默认 token 保证；
  次要文字用 `Typography.Text type="secondary"`（`--ant-color-text-secondary`）。
- 趋势图为 canvas 渲染（ECharts）：`aria` 支持有限，图表旁一律保留同名 `Legend` 文本摘要作为等价信息。
- 状态点（`Badge`）不承载唯一语义：`services` 里的状态在 `Manage` 等页面另有文字表达，避免只靠颜色传意。

## 相关纯函数模块（非组件）

| 模块 | 用途 | 说明 |
|---|---|---|
| `src/procTree.ts` | 进程树组树 / 排序 / 收集展开键 | 纯函数：`buildProcTree`（防环）、`sortProcTree`（内存按「含子进程合计」）、`collectProcPids`（一次性展开键）、`procSortCompare`。子树字段沿用后端返回值，前端不自己数。 |
| `src/format.ts` | 数值 / 时间 / 体积格式化 | `fmtMB` / `fmtBytes` / `fmtRate` / `fmtDuration` / `toneFor` 等，纯函数。 |
