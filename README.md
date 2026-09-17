# admin-web

个人网站 Admin 管理后台前端（React + Vite SPA，部署于独立子域，见 `AGENTS.md` 的部署段）：历史会话只读浏览、系统监控、博客管理。构建产物输出到 `/var/www/admin/`。

## 项目作用

- 历史浏览：`/api/admin/history` 只读查看历史会话记录（标题/时间/消息数 + markdown/图片/文件渲染），**无发送、无 WebSocket**
- 系统监控：CPU/内存/磁盘/网络实时与历史趋势、服务状态、软件版本
- 博客管理：文章/合集增删改查
- 统一 SSO 登录（不再使用本地 TOTP 登录页）

## SSO 接入架构（Nginx 探针 + auth_token）

> 认证中心地址由构建时环境变量 `VITE_AUTH_CENTER_URL` 注入（模板见 `.env.example`，真实 `.env` 不入库）。
> 未配置时回退占位符 `https://auth.example.com/auth`。

1. 未登录访问任意受保护页 → `Login` 组件自动跳转 `<认证中心>/auth?redirect=<当前地址>`；
2. 认证中心登录成功回跳 `redirect#token=<token>`（fragment，不进服务器日志）；
3. `App.jsx` 解析 fragment（或 query）中的 token → **直接存入 `localStorage.auth_token`** → 立即清掉 URL；
4. 所有 REST 请求（`api.js`）携带 `Authorization: Bearer <token>` 头，由 Nginx 探针验证；
5. 任意接口 401 → 清 token → 跳回认证中心。
