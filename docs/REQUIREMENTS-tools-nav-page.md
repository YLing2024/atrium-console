# 需求：工具改为「导航列表 + 独立工具页」

日期：2026-10-20
用户原话：「工具应该是一个类似导航的东西；解锁应该是一个单独的页面。这样的话，你每次都可以把那个页面发给我」

## 现状问题

`src/components/Tools.tsx` 直接把 `BitwardenTool` 卡片（含密码输入框）铺在工具面板里。
结果：打开「工具」就等于打开了密码表单，无法单独把某个工具页发给别人/收藏。
而且 admin 目前**没有 URL 路由**，所有 Tab 都是内存状态，深链接一律落到默认页。

## 目标结构

```text
/tools                 工具导航列表（只有入口，没有表单）
  └─ 点击「Bitwarden 解锁」
/tools/bitwarden       独立的解锁页（唯一有密码输入框的地方）
```

要求：**直接打开 `https://admin.zhangyunling.cn/tools/bitwarden` 就能用**，刷新不丢、可收藏、可分享。

## 一、极简路由（不引依赖）

新增 `src/router.ts`，用原生 History API，**禁止安装 react-router 等任何新依赖**：

```ts
export type Route = { section: string; tool?: string };
export function readRoute(): Route          // 解析 location.pathname
export function navigate(path: string): void // pushState + 派发自定义事件
export function subscribe(fn: () => void): () => void  // 监听 navigate 与 popstate
```

路径映射（与现有 Tab 一一对应，id 保持不变）：

| 路径 | 内容 |
|---|---|
| `/` | 默认落到 `/system`（保持现有默认 Tab） |
| `/system` `/blog` `/manage` `/ssh` `/terminal` `/hermes` `/database` | 现有各 Tab |
| `/tools` | 工具导航列表 |
| `/tools/bitwarden` | Bitwarden 解锁页 |

未知路径 → 重定向到 `/system`（用 `replaceState`，不产生历史记录）。

## 二、`Main.tsx` 改造

1. Tab 状态来源从 `useState` 改为 `readRoute().section`，并 `subscribe` 监听变化
2. `switchTab(id)` 改为 `navigate('/' + id)`，侧栏选中态随之更新
3. **必须保留**：窄屏右侧抽屉 + 顶部「目录」按钮、主题切换、命令面板（`CommandPalette` 的「打开工具」改为 `navigate('/tools')`）
4. 浏览器前进/后退要能正确切 Tab（`popstate`）

## 三、`Tools.tsx` 改为导航列表

去掉对 `BitwardenTool` 的直接渲染，改为纯入口列表：

```text
工具
独立小工具，数据和凭据都由服务端处理。

┌──────────────────────────────────────────────┐
│ Bitwarden 解锁              已锁定  ›        │
│ 把主密码换成 session，供服务器上的 bw CLI 使用  │
└──────────────────────────────────────────────┘
```

- 用 antd `List` 或 `Card` 的 `hoverable`；整行可点，点击 `navigate('/tools/' + id)`
- 右侧显示状态：`已锁定`（灰）/ `已解锁`（绿，带剩余时间）/ `未配置`（灰）
- 状态来源仍是 `GET /api/admin/tools`；进入列表时拉一次
- **列表里不得出现任何输入框**

## 四、新增 `src/pages/ToolBitwarden.tsx`

独立页面，结构：

```text
‹ 工具                              （返回链接，navigate('/tools')）

Bitwarden 解锁
把主密码换成 session，供服务器上的 bw CLI 与本机助手使用。主密码不保存。

状态：已锁定

┌───────────────────────────┐
│ 主密码                     │
└───────────────────────────┘
[ 解锁 ]                [ 清除会话 ]
```

- 直接访问 `/tools/bitwarden` 时自动挂载，**不需要先经过 `/tools`**
- 解锁成功后：状态刷新为「已解锁（剩 3h42m）」、密码框清空、`message.success`
- 解锁失败：`message.error('密码错误')`，密码框清空
- 失败后停在本页，不跳转
- 未配置时：表单禁用，提示「未配置 BITWARDEN_*」
- 输入框 `type="password"`、`autoComplete="off"`，**不写 localStorage / sessionStorage / URL**

## 五、硬约束

- 不新增 npm 依赖
- Ant Design 默认设计语言，不自定义色板
- 移动端（390px）不横向溢出，表单宽度自适应
- 后端接口**一个都不改**（沿用 `/api/admin/tools` 与 `/api/admin/tools/bitwarden/{status,unlock,lock}`）
- 密码仍然只出现在 unlock 那一条 POST 请求体里

## 六、验收

1. `npm run build` 通过，产物 `--outDir` 到临时目录
2. 直接打开 `/tools/bitwarden` → 渲染解锁页（不是被重定向到首页）
3. 在 `/tools` 点击 Bitwarden → 进入 `/tools/bitwarden`，浏览器地址栏同步变化
4. 解锁页点「‹ 工具」→ 回到 `/tools`
5. 刷新 `/tools/bitwarden` 仍停在该页
6. 浏览器后退 → 回到 `/tools`
7. 侧栏各 Tab 切换后 URL 同步；直接打开 `/database` 落在数据库页
8. `/tools` 页面上 `document.querySelectorAll('input[type=password]').length === 0`
9. 解锁成功后状态显示剩余时间；清除会话后回到「已锁定」
10. 390px 宽下无横向溢出
11. 现有 e2e（`e2e/*.spec.ts`）跑通；如有针对旧结构的用例，一并更新

## 七、纪律

- 小步中文提交、不 push
- 只改 admin-web
