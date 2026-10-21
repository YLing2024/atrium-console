# 需求：监控补全 + 磁盘明细前置

日期：2026-10-21
仓库：`admin-server-go`（后端采集）+ `admin-web`（页面）

## 用户原话（必须逐条满足）

> 系统监控里面磁盘也只有一个，必须在最下面才能看到两个的详细信息，而且很多监控你也没补全

## 一、磁盘：两个挂载点都要在首屏看到

现状：KPI 卡片只取根分区（`pickRootDisk`），两个挂载点（`/` 与 `/data`）的明细表排在页面第 4 个分区，要滚到底才看见。

改为：

1. **磁盘 KPI 卡**：标题「磁盘」，主体显示**使用率最高的那个挂载点**的大号百分比 + 进度条；下方一行小字列出**所有挂载点**：`/ 51% · /data 78%`，超 75% 橙色、超 85% 红色
2. **磁盘明细表上移**：从第 4 个分区提到第 2 个（紧跟「趋势」之后、「进程」之前），标题「磁盘」
3. 明细表列：挂载点 / 设备 / 使用率（进度条+数字）/ 已用 / 总量 / inode 使用率 / 读速率 / 写速率 / IOPS / 平均 await
4. 每个挂载点一行，**不再折叠、不再限制条数**

## 二、补全监控指标

### 后端（`internal/probe`）

新增采集，全部来自 `/proc` 与 `/sys`，不引第三方依赖：

| 指标 | 来源 | JSON 字段 |
|---|---|---|
| 运行时长 | `/proc/uptime` | `system.uptime_sec` |
| 僵尸进程数 | `/proc/stat` 的 `procs_blocked` + 遍历 `/proc/*/stat` 取 `Z` 状态计数 | `processes.zombie` |
| 文件句柄数 | `/proc/sys/fs/file-nr` | `system.file_handles {used, max, percent}` |
| TCP 连接状态分布 | `/proc/net/tcp` + `tcp6`，按状态码聚合 | `network.tcp {established, time_wait, close_wait, listen, total}` |
| 网卡丢包/错误 | `/proc/net/dev` 第 4/5/11/12 列 | `network.rx_drops, rx_errors, tx_drops, tx_errors` |
| 每核使用率 | 已有 `cpu.per_core`，确认输出 8 个值（0-100） | `cpu.per_core` |
| 磁盘 IOPS | `/proc/diskstats` 的读/写完成次数差 / 间隔 | `disks[].read_iops, write_iops` |
| 磁盘 await | `/proc/diskstats` 的 `(read_ticks+write_ticks)/完成次数` 差值 | `disks[].await_ms` |
| inode 使用率 | `statfs` 的 `Files/Ffree` | `disks[].inode_percent` |

要求：
- 采集失败只让对应字段缺省（`omitempty`），不能让整帧 SSE 失败
- 采样周期不变（1 秒）；新增采集总耗时 < 5ms（贴实测）
- 不改已有字段语义

### 前端

1. 「趋势」区新增两张图：**网络连接**（established/time_wait 两条线）与 **磁盘 IO**（每挂载点的读/写速率）
2. 「压力与负载」卡补一行：运行时长、僵尸进程、句柄使用率（三个小指标，带 tooltip 说明）
3. CPU 卡增加**每核迷你条**：8 条竖条，按使用率变色，hover 显示核心编号与百分比
4. 内存卡补 `available / buff-cache / swap` 三个细项（现状只有 used/total）

## 三、验收

1. `/api/admin/system/stream` 单帧里能读到全部新字段（贴 key 列表与一条真实值）
2. 新增采集耗时 < 5ms（贴测量代码与结果）
3. 磁盘 KPI 卡显示两个挂载点，截图可见；明细表位于「趋势」之后
4. 每核 8 条、TCP 连接数、inode、IOPS、await 在页面上有真实数字（贴截图）
5. 390px：无横向溢出，卡片纵向排列（贴截图）
6. `make check` 全绿；前端 `npm run check` + `vite build` 通过
7. 提交并 **push 到 GitHub**（两个仓库），回报远端 commit
