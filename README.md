# admin-web

个人网站 Admin 管理后台前端（React + Vite SPA，部署于 `/admin/` 路径）：网页端聊天（Hermes）、系统监控、博客管理。构建产物输出到 `/var/www/admin/`。

## 项目作用

- 聊天界面：经 `/api/admin/ws` WebSocket 与 Hermes 网关双向透传 JSON-RPC
- 系统监控：CPU/内存/磁盘/网络实时与历史趋势、服务状态、软件版本
- 博客管理：文章/合集增删改查
- 统一 SSO 登录（不再使用本地 TOTP 登录页）

## SSO 接入架构（Nginx 探针 + auth_token）

1. 未登录访问任意受保护页 → `Login` 组件自动跳转 `https://auth.zhangyunling.cn/auth?redirect=<当前地址>`；
2. 认证中心登录成功回跳 `redirect#token=<token>`（fragment，不进服务器日志）；
3. `App.jsx` 解析 fragment（或 query）中的 token → **直接存入 `localStorage.auth_token`** → 立即清掉 URL；
4. 所有 REST 请求（`api.js`）携带 `Authorization: Bearer <auth_token>`，由 Nginx 探针验证；
5. WS 连接（`ws.js`）用 `?token=<auth_token>` 传给 `/api/admin/ws`，后端直调认证中心验证；
6. 任意接口 401 → 清 token → 跳回认证中心；WS 4001 同理。

关键点：**前端不再调 `/api/admin/sso/verify` 换本地会话**，认证中心 token 即全部子站共用凭证。

## 开发 / 构建

```bash
cd /root/proj/admin-web
npm install
npm run dev        # 本地开发
npm run build      # 产物 dist/ → cp -r dist/* /var/www/admin/
```

## 关键文件

| 文件 | 说明 |
|---|---|
| `src/api.js` | token 存取（key: `auth_token`）、统一请求封装、401 自动跳 SSO |
| `src/App.jsx` | 回跳 token 解析与落库、路由骨架 |
| `src/ws.js` | WS 客户端：心跳保活、指数退避重连、JSON-RPC 封装 |
| `src/components/Login.jsx` | SSO 中转页（自动跳认证中心） |
