import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 仅用于 Hermes 验收：dev server 跑 5199，/api 代理到**隔离实例** 3199（绝不指向生产 3100）。
// 隔离环境里没有前置认证层（生产由网关提供 /_auth/*），所以这里给 sso 模式的 /_auth/me
// 补一个固定身份的桩，否则应用会卡在启动的身份探测上、渲染空白。
const verifyAuthStub = {
  name: 'verify-auth-stub',
  configureServer(server) {
    server.middlewares.use('/_auth/me', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ sub: 'verification', name: 'verification', app: 'admin' }));
    });
  }
};

export default defineConfig({
  base: '/',
  plugins: [react(), verifyAuthStub],
  server: {
    port: 5199,
    host: '127.0.0.1',
    proxy: {
      // 隔离后端是 sso 模式，信任该头（仅用于验收，不影响生产构建）
      '/api': {
        target: 'http://127.0.0.1:3199',
        changeOrigin: true,
        headers: { 'X-Auth-User': 'verification' }
      }
    }
  }
});
