import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    proxy: {
      // 开发环境把 /api 请求（含 WebSocket 升级）代理到 admin-server
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    outDir: '/var/www/admin',
    emptyOutDir: true
  }
});
