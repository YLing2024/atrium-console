// 公共站点基址：构建期注入；仓库只留占位域
const RAW = (import.meta.env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
export const SITE_URL = RAW || 'https://site.example.com';

/** 把站内路径拼成公共站点的绝对地址 */
export function siteUrl(path: string): string {
  const p = String(path || '');
  return SITE_URL + (p.startsWith('/') ? p : '/' + p);
}
