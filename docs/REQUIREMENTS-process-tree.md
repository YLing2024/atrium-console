# 需求：进程排行改造为「全量进程树」（父子结构 + 子树合计）

> 用户 2026-10-13 反馈两件事：① 「进程排行看着非常不全」→ 实测只显示内存前 15 个；
> ② 「321 这么多吗？能做成树状的吗？应该有子进程这种结构」→ 改为可展开的进程树。

## 事实（实测，2026-10-13）

- 后端 `src/metrics/proctop.ts` 用 `ps -eo pid,comm,rss,pcpu,args --sort=-rss | head -16 | tail -15`，**只取内存前 15 个**。
- 本机实际 **321 个进程**：容器内 94、主机侧 227；顶层节点 73 个、最深 7 层。
- 前 15 名合计 2721 MB，**全部进程 5305 MB** —— 一半以上内存和 306 个进程完全看不见。
- SSE `/api/admin/system/stream` 每 **1000ms** 推一帧（含 `system/services/history`），且 nginx 明确不对 `text/event-stream` 做 gzip（`/etc/nginx/nginx.conf` 有注释）。
  → 把 321 行进程塞进 1s 帧（约 22 KB/帧）会白烧带宽 + 前端每秒重渲染几百行，**必须解耦**。

## 目标形态（用户要的）

「进程排行」= 一棵可展开 / 折叠的进程树：

- 每个进程一个节点，子进程嵌在父进程下（按 `ppid` 挂）。
- 列：状态点 / 进程名（树形缩进）/ PID / 内存（自身 RSS）/ CPU（自身）。
- 有子节点的行，名称后以**次要文字**显示子树规模与合计，例如「6 个进程 · 638 MB · 3.2%」（数据来自后端 `subtree_*`）。
- 同级排序沿用现有切换（按名称 / 按内存 / 按 CPU）——排序只作用在同一父节点下的兄弟之间。
- **默认全部展开**（用户要"看全"），可逐级折叠。
- 表格卡片内滚动（`y: '60vh'`），**不分页**（用户明确要"全"）。
- 合计行保留并补齐：进程数（PID 列）+ 内存合计（内存列）+ CPU 合计（CPU 列，语义不变＝系统总占用 `total_cpu`）。

---

## 一、admin-server（后端）

涉及：`src/metrics/proctop.ts`（核心）、`src/routes/system.ts`（装配）、必要时 `src/probe/services.ts`、新增 `test/proctop.test.ts`。

1. **不再截断**：`ps -eo pid,ppid,comm,rss,pcpu,args --sort=-rss`（**新增 `ppid`**，去掉 `head/tail`），解析全部进程。
2. **安全上限**：硬上限 500 行；超出按内存降序截断并在响应里标 `truncated: true`（本机 321，正常不触发）。
3. **响应字段**（既有字段名不变，新增用蛇形）：
   - 单行：`{ name, pid, ppid, mem_mb, cpu }`
   - 顶层：`{ services, processes, count, truncated, total_mem_mb, total_cpu }`
     - `count`：解析到的进程总数（**截断前**）
     - `total_mem_mb`：全部进程 RSS 之和（MB，整数）
     - `total_cpu`：**语义不变**（`collectAllProcCpu()` 的系统总占用，不是列表之和）
     - 单行内新增 `subtree_mem_mb` / `subtree_cpu`：**该节点含全部后代的和**（前端直接显示，不自己算）
4. **命名规则保持不变**（systemd MainPID → 单位名；opencode / agent-browser / pi / aionui / node / python / comm 兜底），仅新增一条：
   - **容器 shim 命名**：`comm` 匹配 `containerd-shim*` 的进程，从 `args` 里取 `-id <容器 ID>`；用**一次** `docker ps --format '{{.ID}} {{.Names}}'`（timeout 3s）建「12 位短 ID → 容器名」映射，按**前缀匹配**（shim 的 args 里通常是 64 位全长 ID），命中则命名为容器名（如 `vaultwarden`）；`docker` 不可用 / 查不到 → 静默回退 `comm`，**不得报错、不得让采集变慢**（失败不影响其余进程）。
   - 理由：94 个进程在容器内，平铺时全是 `containerd-shim`，看不出是哪个应用。
5. **SSE 帧瘦身**：`/api/admin/system/stream` 的 1s 快照**不再携带进程明细**，保持结构 `{ system, services: { services, total_cpu }, history }`（`services` 数组与 `total_cpu` 照旧）。进程明细改由 REST 提供。
6. `GET /api/admin/services` 路由与鉴权不变，返回第 3 条的全量字段。
7. **单测**（`node:test`，本仓既有风格）：新增 `test/proctop.test.ts`，至少覆盖
   - `ps` 文本 → 行数组的纯函数解析（含 pid/ppid/rss→mem_mb/cpu 兜底）；
   - 子树合计：构造小树，断言根 `subtree_mem_mb` = 全部之和、叶子 = 自身、`subtree_cpu` 同理；
   - 超过 500 上限时截断且 `truncated=true`、`count` 仍为截断前总数；
   - shim `args` → 容器 ID 提取 + 短 ID 前缀匹配（纯函数，**不真调 docker**）。
   > 为了可测：把「ps 文本 → 行数组」「构造父子关系并算子树合计」抽成**纯函数**并从模块导出（保持 CommonJS 写法）。
8. `npm run check` 全过。**不要重启 admin-server / 不要 systemctl**（部署由 Hermes 做）。

## 二、admin-web（前端）

涉及：`src/components/System.tsx`（主）、`src/api.ts`（如需新增取数函数）、`AGENTS.md`（一句事实描述）。

1. **取数解耦**：进程明细改从 REST `GET /api/admin/services` 拉，**仅当「系统」Tab 处于激活态时**生效：
   - 激活时立即拉一次，此后每 **5 秒** 一次；Tab 切走 / 组件卸载立即停（`AbortController` + 清定时器，不得残留）。
   - SSE 仍 1s 推系统指标、`services` 列表（状态点用）与 `total_cpu`；**`processes` 不再从 SSE 读**。
   - 拉取失败**不清空**已有列表（保留上次数据），沿用现有错误处理习惯，不弹新 UI。
2. **树形表格**（antd Table 原生树数据）：
   - 前端按 `pid/ppid` 组树：`ppid` 不在本次列表内的进程（含 ppid 0/1）作为根；**必须防环**（遇到环把该节点提为根，绝不无限递归）。
   - `rowKey="pid"`、`defaultExpandAllRows`、`pagination={false}`、`expandable` 用 antd 默认缩进。
   - 同级排序沿用现有 `procSort`（名称 `localeCompare('zh')` / 内存 / CPU 降序），排序作用在兄弟之间。
   - 列：状态点（宽度不变，沿用 `services.find(s => s.pid === p.pid)?.status === 'down'`）/ `进程`（树形；有子节点时名称后次要文字「N 个进程 · X MB · Y%」，取自 `subtree_mem_mb` / `subtree_cpu`）/ `PID` / `内存` / `CPU`。
     **不新增"累计"独立列**（次要文字已承载）。
   - `scroll={{ x: 'max-content', y: '60vh' }}`；原有的 `sticky={{ offsetHeader: 64 }}` 若与内滚动叠加出现表头错位/双吸顶，则只保留内滚动（在报告里说明取舍）。
   - 合计行：`合计（全部进程）`，PID 列显示 `count` 个、内存列显示 `total_mem_mb`、CPU 列显示 `total_cpu`（原来只有 CPU）。
3. **文案**：不新增解释性文字，不加"刷新"按钮（有 5s 自动取样），禁 emoji。
4. 颜色一律 antd token，不新增自定义色值；**不动公开页**（`AppCard.tsx` / `AppIcon.tsx` / `PublicApps.tsx` 一个字不许改）。
5. **注释/文档如实更新**：`System.tsx` 中「…无任何轮询」的注释改为「系统指标走 SSE；进程全量列表在系统 Tab 激活时每 5s 取样一次」；`AGENTS.md` 里同一事实描述同步改（只改这一句，别动别的规则）。
6. `npm run check` 全过。**验收构建必须覆盖输出目录**：`BUILD_OUT_DIR=/tmp/admin-web-verify npx vite build --emptyOutDir`（或仓库内 `vite.verify.config.mjs`）；**绝不裸跑 `npm run build`（会清空 /var/www/admin）**，也不要碰 `/var/www/admin`。

## 三、共同红线

- 不动 `authRequired` 鉴权、不动 `src/api.ts` 的 401 流程、不动采样器 Redis 前缀/锁。
- 不改 `/api/admin/system`、`/api/admin/system/history`、`/api/admin/system/metrics` 的既有字段与语义。
- 口径不许混：`total_cpu` = 系统总占用（不是列表之和）；`total_mem_mb` = 全部进程 RSS 之和（含共享内存重复计算，字段名如实表达即可）。
- 无热重载：改完**不要重启任何服务**，由 Hermes 统一部署验证。
- 小步 commit（conventional commits、**无工具署名**），不 push、不建分支、不 rebase/reset/merge。
- 结束隔离测试进程**只能按 PID**（`ss -ltnp` 反查后 `kill` 该 PID），**禁止 `systemctl` / `pkill` / 按进程名杀**。
- 命令一律带 `timeout`；不得写死私有域名 / 公网 IP / 密钥。

## 四、隔离自测要求（必须给出证据）

- **后端**：`PORT=3199` + 隔离的 `ADMIN_REDIS_PREFIX` / `ADMIN_SAMPLER_LOCK` / `ADMIN_CONFIG_PATH` / `ADMIN_APPS_FILE`（**绝不能碰线上 3100 的 Redis 键与采样锁**），打印：
  - `/api/admin/services` 的 `processes` 条数（应≈实测进程数）、含 `ppid`/`subtree_mem_mb` 的样例行 3 条；
  - `count` / `total_mem_mb` 与 `ps` 实测（`ps -eo rss --no-headers | awk '{s+=$1} END{print s/1024}'`）一致；
  - 子树合计自检：任取一个父节点，`subtree_mem_mb` 应等于其自身 + 全部后代之和。
- **前端**：`vite.verify.config.mjs`（5199 → 3199）打开系统 Tab，打印：
  - 表格行数（应≈进程数）、`defaultExpandAllRows` 生效（展开箭头状态）、折叠一级后行数变化；
  - 同级按内存排序生效（打印前 3 行名称+内存）；
  - 合计行三个数字的实际文本；
  - 深色 / 浅色各一遍无白块、控制台 0 error；
  - Tab 切走后 5s 定时是否真的停（打印切换前后的请求计数或定时器状态）。
