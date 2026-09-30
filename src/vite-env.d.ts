/// <reference types="vite/client" />

// 构建期环境变量（.env，仓库只提交 .env.example 占位）。
// 真实域名只写在本地 .env，源码与仓库不得出现。
interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_HERMES_DASHBOARD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
