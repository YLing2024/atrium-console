import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

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
    emptyOutDir: true,
    rollupOptions: {
      // 多入口：后台 index.html 入口不变，另加公开「应用中心」public.html
      input: {
        index: resolve(rootDir, 'index.html'),
        public: resolve(rootDir, 'public.html')
      }
    }
  }
});
