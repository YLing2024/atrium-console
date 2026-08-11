/**
 * REST API 封装：token 存取、统一请求、401 自动跳登录页
 */

const TOKEN_KEY = 'admin_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// 清除 token 并回到登录页
export function logout() {
  clearToken();
  location.href = '/admin/';
}

async function request(path, options = {}) {
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
  if (res.status === 401) {
    logout(); // 凭证失效，跳回登录页
    throw new Error('未登录或登录已过期');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// 登录：返回 { token }
export function login(password) {
  return request('/api/admin/login', { method: 'POST', body: { password } });
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
