/**
 * REST API 封装：认证中心 token（auth_token）存取、统一请求、
 * 401 自动清 token 并跳认证中心（SSO）
 */

const TOKEN_KEY = 'auth_token';
// 认证中心地址：构建时由 VITE_AUTH_CENTER_URL 注入（真实地址只存本地 .env，不入库）
// 未注入时回退占位符，保证开源克隆 / 未配置环境下不暴露私有地址
const AUTH_CENTER_URL =
  (import.meta.env.VITE_AUTH_CENTER_URL || '').trim() || 'https://auth.example.com/auth';

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

// 粒度聚合历史（趋势图切换分钟/小时/天档位时使用）
// 返回 { step, range, points: [{ ts, cpu, mem_percent, ... }] }（points 与 /history 同构）
export function getSystemMetrics(range, step) {
  return request(
    `/api/admin/system/metrics?range=${encodeURIComponent(range)}&step=${encodeURIComponent(step)}`
  );
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

// 取「打开文章页」地址（需鉴权）：已发布回公开地址，草稿附短时效预览令牌
export function getBlogPostPreviewLink(id) {
  return request(`/api/blog/admin/posts/${id}/preview-link`);
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

// ============ 接口令牌管理（与登录设备完全隔离） ============

// 接口令牌列表，返回 { tokens: [...] }（绝不含 token 明文）
export function getApiTokens() {
  return request('/api/admin/api-tokens');
}

// 生成接口令牌，data: { name, note, expiresInDays }，返回 { id, token, meta }（明文仅此一次）
export function createApiToken(data) {
  return request('/api/admin/api-tokens', { method: 'POST', body: data });
}

// 更新接口令牌，patch 可选 { name, note, expiresInDays }
export function updateApiToken(id, patch) {
  return request(`/api/admin/api-tokens/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

// 吊销接口令牌（立即失效）
export function deleteApiToken(id) {
  return request(`/api/admin/api-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ============ 历史会话浏览（只读） ============

// 历史会话列表，返回 { sessions: [{ id, title, time, message_count }] }
export function getHistorySessions() {
  return request('/api/admin/history');
}

// 单个历史会话消息，返回 { session: { id, title }, messages: [{ role, content, ts }] }
export function getHistoryMessages(id) {
  return request('/api/admin/history/' + encodeURIComponent(id));
}

// ============ 文件区（目录浏览 / 上传 / 下载 / 新建 / 重命名 / 删除） ============
// path 均为相对文件区根目录的路径，根目录为 ''（后端做越界校验）

// 列目录，返回 { path, parent, entries: [{ name, type: 'dir'|'file', size, mtime }] }
export function listFiles(path = '') {
  return request(`/api/admin/files?path=${encodeURIComponent(path)}`);
}

// 新建文件夹
export function makeDir(path, name) {
  return request('/api/admin/files/mkdir', { method: 'POST', body: { path, name } });
}

// 重命名文件或目录（path 为完整相对路径，name 为新名称）
export function renameEntry(path, name) {
  return request('/api/admin/files/rename', { method: 'POST', body: { path, name } });
}

// 删除文件或目录（目录递归）
export function deleteEntry(path) {
  return request(`/api/admin/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

// 下载地址：<a>/window.open 无法带自定义头，token 只能走 query（nginx 探针支持 ?token=）
export function fileDownloadUrl(path) {
  const token = getToken() || '';
  return `/api/admin/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
}

// 上传单个文件（必须用 XHR：fetch 拿不到上传进度）
// onProgress({ loaded, total, percent }) · onDone(data) · onError(err)；返回 xhr 供调用方 abort()
export function uploadFileTo(path, file, { onProgress, onDone, onError } = {}) {
  const xhr = new XMLHttpRequest();
  const token = getToken();
  xhr.open('POST', `/api/admin/files/upload?path=${encodeURIComponent(path)}`);
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

  xhr.upload.onprogress = (e) => {
    if (onProgress && e.lengthComputable) {
      onProgress({
        loaded: e.loaded,
        total: e.total,
        percent: e.total ? (e.loaded / e.total) * 100 : 0
      });
    }
  };
  xhr.onload = () => {
    let data = {};
    try {
      data = JSON.parse(xhr.responseText || '{}');
    } catch (e) {
      data = {};
    }
    if (xhr.status === 401) {
      logout(); // 凭证失效
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      if (onDone) onDone(data);
    } else if (onError) {
      onError(new Error(data.error || `HTTP ${xhr.status}`));
    }
  };
  xhr.onerror = () => onError && onError(new Error('网络错误，上传中断'));
  xhr.onabort = () => onError && onError(new Error('已取消'));

  const fd = new FormData();
  fd.append('file', file);
  xhr.send(fd);
  return xhr;
}

// ============ 文件临时链接（限时分享） ============
// 语义与 v2link 对齐：expiresAt === 0 表示永久有效；status 由后端按
// revokedAt / expiresAt 推导。链接地址一律用后端返回的 url，前端不拼域名。

// 创建临时链接：path 为文件区相对路径；data 可含 { expiresAt }（ms，0 = 永久）
// 或 { ttlHours }（二选一，同时给以 expiresAt 为准），以及可选 note。
export function createFileShare(path, data = {}) {
  return request('/api/admin/files/shares', {
    method: 'POST',
    body: { path, ...data }
  });
}

// 临时链接列表（按 createdAt 倒序），返回 { shares: [...] }
// 每项含计算字段：url / status / remainingMs / fileExists
export function listFileShares() {
  return request('/api/admin/files/shares');
}

// 改期 / 转永久（expiresAt: 0）/ 改备注 / 撤销（revoked: true，不可逆）
export function updateFileShare(id, patch) {
  return request(`/api/admin/files/shares/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch
  });
}

// 删除链接记录（不动磁盘文件）
export function deleteFileShare(id) {
  return request(`/api/admin/files/shares/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

// ============ 通知中心 ============
// 返回 { items: [{ id, ts, level, source, type, title, body, link, readAt }], unread, total }
// ts / readAt 为 epoch 秒。params: { limit, before, level, source, type, unread }
export function getNotifications(params = {}) {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.before) q.set('before', String(params.before));
  if (params.level) q.set('level', params.level);
  if (params.source) q.set('source', params.source);
  if (params.type) q.set('type', params.type);
  if (params.unread) q.set('unread', '1');
  const s = q.toString();
  return request('/api/admin/notifications' + (s ? '?' + s : ''));
}

// 通知类别（服务端定义）→ { types: [{ key, label, description, defaultLevel, sort, enabled, count, unread }] }
// 客户端不得内置任何类别清单，筛选器一律由此接口动态渲染。
export function getNotificationTypes() {
  return request('/api/admin/notifications/types');
}

// 单条已读
export function markNotificationRead(id) {
  return request(`/api/admin/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

// 全部已读，返回 { ok, count }
export function markAllNotificationsRead() {
  return request('/api/admin/notifications/read-all', { method: 'POST' });
}

// 删除
export function deleteNotification(id) {
  return request(`/api/admin/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// 主动推送一条通知（发通知表单），返回 { id, ts }
export function createNotification(payload) {
  return request('/api/admin/notifications', { method: 'POST', body: payload });
}

// 批量删除：filters { level?, source?, unreadOnly?, readOnly?, dryRun? } → { ok, count }
// dryRun=true 只统计不删除（用于二次确认时展示准确条数）
export function bulkDeleteNotifications(filters = {}) {
  const body = {};
  if (filters.level) body.level = filters.level;
  if (filters.source) body.source = filters.source;
  if (filters.unreadOnly) body.unreadOnly = true;
  if (filters.readOnly) body.readOnly = true;
  if (filters.dryRun) body.dryRun = true;
  return request('/api/admin/notifications/bulk-delete', { method: 'POST', body });
}

// 统计 → { total, unread, sources: [{ source, count }] }
export function getNotificationStats() {
  return request('/api/admin/notifications/stats');
}
