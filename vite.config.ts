import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      // 开发环境把 /api 请求代理到 admin-server
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true
      }
    }
  },
  build: {
    // 默认仍写生产目录（与历史行为一致）；CI 等场景用 BUILD_OUT_DIR 覆盖，避免误写生产
    outDir: process.env.BUILD_OUT_DIR || '/var/www/admin',
    emptyOutDir: true
  }
});
