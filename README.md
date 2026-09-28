# admin-web

个人网站 Admin 管理后台前端（React + Vite SPA，部署于独立子域，见 `AGENTS.md` 的部署段）：历史会话只读浏览、系统监控、博客管理。构建产物输出到 `/var/www/admin/`。

## 项目作用

- 历史浏览：`/api/admin/history` 只读查看历史会话记录（标题/时间/消息数 + markdown/图片/文件渲染），**无发送、无 WebSocket**
- 系统监控：CPU/内存/磁盘/网络实时与历史趋势、服务状态、软件版本
- 博客管理：文章/合集增删改查
- 统一登录：登录 / OAuth2 / 会话全部由 Auth Gateway 负责，前端不再有自己的登录页

## 鉴权接入架构（Auth Gateway）

> 身份由 Auth Gateway 的站点会话 cookie 证明；前端**零** OAuth / token / 登录态代码。
>
> 侧栏「Hermes」页的 iframe 地址由构建时环境变量 `VITE_HERMES_DASHBOARD_URL` 注入，
> 未配置时回退占位符 `https://hermes.example.com`。真实域名只写在本地 `.env`，仓库只留占位项。

1. 启动时调用 `GET /_auth/me`：
   - 200 → 直接进入应用（用户身份取响应字段），**不再显示自己的登录页**；
   - 401 → 整页跳 `/_auth/login?next=<当前地址>`。
2. 所有 REST 请求（`api.js`）不再读写 `localStorage` token，由网关 cookie 证明身份（同源自动携带）。
3. 任意接口 401 → 统一全局拦截，整页跳 `/_auth/login?next=<当前地址>`（不做重试循环）。
4. 退出登录 → 跳 `/_auth/logout`。
