/**
 * REST API 封装：认证中心 token（auth_token）存取、统一请求、
 * 401 自动清 token 并跳认证中心（SSO）
 */

const TOKEN_KEY = 'auth_token';
const AUTH_CENTER_URL = 'https://auth.zhangyunling.cn/auth';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// 携带回跳地址跳转认证中心
export function redirectToSso() {
  const redirect = encodeURIComponent(location.href);
  location.href = `${AUTH_CENTER_URL}?redirect=${redirect}`;
}

// 清除 token 并跳转认证中心
export function logout() {
  clearToken();
  redirectToSso();
}

async function request(path, options = {}, reqOpts = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const opts = { ...options, headers };
  // 非 FormData 的 body 统一 JSON 序列化
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }

  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  // 非登录相关接口 401：凭证失效 → 清 token 并跳认证中心
  if (res.status === 401 && !reqOpts.skip401) {
    logout(); // 凭证失效，跳回认证中心
    throw new Error('未登录或登录已过期');
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.code = data.code; // 附带给业务用的错误码（如 totp_setup_required / rate_limited）
    err.status = res.status;
    err.retryAfter = data.retryAfter; // 429 限速剩余秒数
    throw err;
  }
  return data;
}

// TOTP 首次设置（仅未配置时可用），返回 { secret, otpauthUri }
export function totpSetup() {
  return request('/api/admin/totp/setup', { method: 'POST' });
}

// TOTP 重置第一阶段（需已登录）：生成 pending secret，返回 { secret, otpauthUri, expiresIn }
export function totpReset() {
  return request('/api/admin/totp/reset', { method: 'POST' });
}

// TOTP 重置第二阶段（需已登录）：用 pending secret 生成的新验证码确认转正
export function totpResetConfirm(code) {
  return request('/api/admin/totp/confirm', { method: 'POST', body: { code } });
}

// 系统信息
export function getSystem() {
  return request('/api/admin/system');
}

// 历史采样（趋势图数据）
export function getSystemHistory() {
  return request('/api/admin/system/history');
}

// 服务状态列表
export function getServices() {
  return request('/api/admin/services');
}

// 软件版本监控（仅本地当前版本，秒回）
export function getVersions() {
  return request('/api/admin/versions');
}

// 上传文件，返回 { path: 绝对路径 }
export function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  return request('/api/admin/upload', { method: 'POST', body: fd });
}

// 修改密码
export function changePassword(old_password, new_password) {
  return request('/api/admin/password', {
    method: 'POST',
    body: { old_password, new_password }
  });
}

// 上传博客图片，返回 { url }
export function uploadBlogImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  return request('/api/blog/admin/upload', { method: 'POST', body: fd });
}
export function downloadUrl(filePath) {
  const token = getToken() || '';
  return `/api/admin/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
}

// ============ 博客接口 ============
// 管理接口带 Admin token（blog-server 双通道认证：blog JWT 或 Admin Redis 会话）

// 公开文章列表（仅已发布，返回 { list, total, totalPages, ... }）
export function getBlogPosts() {
  return request('/api/blog/posts');
}

// 公开文章详情
export function getBlogPost(slug) {
  return request(`/api/blog/posts/${slug}`);
}

// 全部文章（含草稿与正文，需鉴权）
export function getBlogAdminPosts() {
  return request('/api/blog/admin/posts');
}

// 新建文章（需鉴权），data: { title, slug, tags, excerpt, content, published }
export function createBlogPost(data) {
  return request('/api/blog/admin/posts', { method: 'POST', body: data });
}

// 更新文章（需鉴权）
export function updateBlogPost(id, data) {
  return request(`/api/blog/admin/posts/${id}`, { method: 'PUT', body: data });
}

// 删除文章（需鉴权）
export function deleteBlogPost(id) {
  return request(`/api/blog/admin/posts/${id}`, { method: 'DELETE' });
}

// ---------- 合集接口 ----------

// 公开合集列表（仅已发布文章数，返回 { list }）
export function getBlogCollections() {
  return request('/api/blog/collections');
}

// 公开合集详情（按 slug）
export function getBlogCollection(slug) {
  return request(`/api/blog/collections/${encodeURIComponent(slug)}`);
}

// 全部合集（含草稿文章数，需鉴权）
export function getBlogAdminCollections() {
  return request('/api/blog/admin/collections');
}

// 新建合集（需鉴权），data: { name, slug, description }
export function createBlogCollection(data) {
  return request('/api/blog/admin/collections', { method: 'POST', body: data });
}

// 更新合集（需鉴权）
export function updateBlogCollection(id, data) {
  return request(`/api/blog/admin/collections/${id}`, { method: 'PUT', body: data });
}

// 删除合集（需鉴权，文章 collection_id 置 NULL）
export function deleteBlogCollection(id) {
  return request(`/api/blog/admin/collections/${id}`, { method: 'DELETE' });
}

// ============ 设备会话管理 ============

// 已登录设备列表（需鉴权），返回 { sessions: [...] }
export function getSessions() {
  return request('/api/admin/sessions');
}

// 重命名设备，id 为会话 token
export function renameSession(id, deviceName) {
  return request(`/api/admin/sessions/${id}/name`, { method: 'PUT', body: { deviceName } });
}

// 删除设备会话（撤销其登录凭证，该设备必须重新认证）
export function deleteSession(id) {
  return request(`/api/admin/sessions/${id}`, { method: 'DELETE' });
}
