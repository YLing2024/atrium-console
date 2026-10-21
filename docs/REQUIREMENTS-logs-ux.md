# 需求：日志页交互重构（全屏高度 + 滚动到底自动加载 + 详情抽屉）

日期：2026-10-21
文件：`admin-web/src/pages/Logs.tsx`（230 行）

## 用户原话（必须逐条满足）

> 日志，交互很不好，应该是滚动到底部自动加载，而不是点击加载，而且你这个滚动区域也不是全屏的，而且你日志也看不全，你可以考虑做一个详情，点击一个抽屉这种，起码让我能看全。

## 一、滚动区域占满可用高度

- 表格滚动区高度 = 视口高度 − 顶部筛选区高度 − 卡片头部，用 `ResizeObserver` 或 `calc(100vh - Xpx)` 计算，随窗口缩放实时更新
- 目标：页面本身**不出现纵向滚动条**，只有表格内部滚动（`document.documentElement.scrollHeight <= innerHeight`）
- 最小高度 360px，避免矮窗口下表格被压扁

## 二、滚动到底自动加载

- 去掉「加载更多」按钮（保留「到底了」的结束提示）
- 监听表格内部滚动容器的 `scroll` 事件：`scrollTop + clientHeight >= scrollHeight - 80` 时自动请求下一页
- 并发保护：请求中不再触发；`hasMore=false` 停止；请求失败显示「加载失败，点击重试」小提示，不自动重试
- 加载中在表格底部显示一行 spinner（不遮挡已有行）
- **保留**：切换来源/关键字/时间范围时重置 offset=0

## 三、点击一行打开详情抽屉

- 行可点击（`rowClassName` 加 `logs-row-clickable`，`cursor: pointer`），hover 有底色
- 抽屉：`Drawer` 宽 720（窄屏 100%），标题为「日志详情」，右上角关闭
- 抽屉内容：
  1. 顶部一行：来源 Tag、级别 Tag（error/warn 用色）、时间（含毫秒）
  2. 字段表（`Descriptions`，`column=1`，`bordered`）：主机、单元/容器/文件路径、进程、PID、请求方法、路径、状态码、耗时、客户端 IP，**有值才显示**
  3. 完整内容：`<pre>` 等宽字体、自动换行、可选中，最大高度 `calc(100vh - 320px)` 内部滚动；保留换行与缩进
  4. 底部按钮：复制全文（`navigator.clipboard`，失败降级 `document.execCommand`）、复制为 JSON
- 抽屉打开时表格滚动位置不变；关闭后焦点回到原行

## 四、后端

现状：`GET /api/admin/logs?source=&q=&since=&limit=&offset=`，返回 `{entries:[...], hasMore:bool}`。

若详情需要的字段未返回（例如 error 表没有 `client_ip`、file_logs 没有 `path`），**只补 SELECT 列，不改表结构、不改接口契约**；新字段统一 `omitempty`。

## 五、验收

1. 贴 `document.documentElement.scrollHeight` 与 `innerHeight` 的实际值，证明页面无外层滚动
2. 滚到底部后自动追加下一页（贴两次请求的 offset 与返回条数，证明不是同页重复）
3. 点击一行打开抽屉，贴抽屉内完整内容截图（含长行换行，不截断）
4. 抽屉复制按钮实测写入剪贴板（贴 `navigator.clipboard.readText()` 前 60 字）
5. 390px 视口：抽屉全宽、无横向溢出（贴截图）
6. `npm run check` 全绿；`vite build` 通过
7. 提交并 **push 到 GitHub**，回报远端 commit
