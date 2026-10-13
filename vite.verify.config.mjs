import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 仅用于 Hermes 验收：dev server 跑 5199，/api 代理到**隔离实例** 3199（绝不指向生产 3100）
export default defineConfig({
  base: '/',
  plugins: [react()],
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
