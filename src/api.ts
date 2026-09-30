/**
 * REST API 封装：身份由同源会话 cookie 证明（请求自带 cookie），不读写 localStorage token。
 * 认证模式由后端 `GET /api/admin/auth-mode` 探测并缓存：
 *   builtin（默认）—— 自带账号：本地登录页 + 会话 cookie；401 回登录页
 *   sso           —— 关掉自带口令：身份来自前置认证层；401 整页跳 /_auth/login
 * 探测失败（网络错误 / 非 JSON / 404 旧后端）一律按 sso 处理，绝不回退 builtin。
 */

const MODE_BUILTIN = 'builtin';

/** 认证模式：builtin 自带账号 / sso 前置认证层 */
export type AuthMode = 'builtin' | 'sso';

/** 后端错误响应附加字段（与 Error 实例同体抛出） */
export interface ApiError extends Error {
  code?: string;
  status?: number;
  retryAfter?: number;
}

/** 接口错误响应体（含业务错误码 / 429 剩余秒数） */
interface ApiEnvelope {
  error?: string;
  code?: string;
  retryAfter?: number;
  [key: string]: unknown;
}

let redirecting = false;
let authModeCache: AuthMode | null = null; // 'builtin' | 'sso' | null（未探测）
let authModePromise: Promise<AuthMode> | null = null;
let unauthorizedHandler: (() => void) | null = null; // builtin 模式会话失效时由 App 注册（切回登录页）

// 探测认证模式：成功按响应取值；任何失败一律 sso（保持现状行为）
export function getAuthMode(): Promise<AuthMode> {
  if (authModeCache) return Promise.resolve(authModeCache);
  if (!authModePromise) {
    authModePromise = fetch('/api/admin/auth-mode', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ authMode?: string }>;
      })
      .then((data) => (data && data.authMode === MODE_BUILTIN ? MODE_BUILTIN : 'sso'))
      .catch(() => 'sso' as const)
      .then((mode) => {
        authModeCache = mode;
        return mode;
      });
  }
  return authModePromise;
}

// 已探测到的模式（未探测为 null）。请求路径一律先 await getAuthMode()
export function currentAuthMode(): AuthMode | null {
  return authModeCache;
}

// 注册 builtin 模式会话失效回调（App 用来切回本地登录页）；传 null 注销
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn || null;
}

// 会话失效（401）统一出口：builtin → 回本地登录页；sso → 整页跳网关登录页
function handleUnauthorized(): void {
  if (authModeCache === MODE_BUILTIN) {
    if (unauthorizedHandler) unauthorizedHandler();
    return;
  }
  redirectToLogin();
}

// 401 → 整页跳网关登录页，next 带回当前地址（pathname + search）；仅 sso 模式使用
export function redirectToLogin(): void {
  // 已经在认证层的页面上就不再跳（否则 next 会被逐层嵌套，形成无限跳转）
  if (location.pathname.startsWith('/_auth/')) return;
  if (redirecting) return;
  redirecting = true;
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = `/_auth/login?next=${next}`;
}

// 退出登录：builtin → 调本地登出接口后回登录页；sso → 跳网关登出
export async function logout(): Promise<void> {
  const mode = await getAuthMode();
  if (mode !== MODE_BUILTIN) {
    location.href = '/_auth/logout';
    return;
  }
  try {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (e) {
    // 网络失败也照常回到登录页
  }
  if (unauthorizedHandler) unauthorizedHandler();
}

/** 当前身份（builtin 的 /me 或网关 /_auth/me 响应） */
export interface MeInfo {
  sub?: string;
  name?: string;
  app?: string;
  [key: string]: unknown;
}

// 启动时问「当前是谁」：
//   builtin → GET /api/admin/me；401 返回 null（不跳转，由 UI 显示本地登录页）
//   sso     → GET /_auth/me；401 整页跳网关登录页
export async function getMe(): Promise<MeInfo | null> {
  const mode = await getAuthMode();
  const res = await fetch(mode === MODE_BUILTIN ? '/api/admin/me' : '/_auth/me', {
    credentials: 'same-origin'
  });
  if (res.status === 401) {
    if (mode === MODE_BUILTIN) return null;
    redirectToLogin();
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // 必须是「带身份字段的 JSON」才算登录成功：网关 /_auth/me 返回 {sub,name,app}。
  // 若 /_auth/ 没被正确转给认证层（例如漏配 location、被静态文件兜底成 index.html），
  // 响应会是 200 + HTML —— 那种情况绝不能当作已登录，否则会在未鉴权的情况下渲染管理界面。
  const data: unknown = await res.json().catch(() => null);
  const me = data as MeInfo | null;
  if (!me || typeof me !== 'object' || !String(me.sub || me.name || '').trim()) {
    throw new Error('身份响应无效');
  }
  return me;
}

// 本地登录（仅 builtin）：POST {code}（TOTP 动态码）；成功后后端下发 HttpOnly 会话 cookie。
// 失败错误附 code（totp_setup_required / rate_limited）与 retryAfter（秒），供登录页分支处理。
export async function login(code: string): Promise<Record<string, unknown>> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  const data = (await res.json().catch(() => ({}))) as ApiEnvelope;
  if (!res.ok) {
    const err: ApiError = new Error(data.error || `HTTP ${res.status}`);
    err.code = data.code;
    err.status = res.status;
    err.retryAfter = data.retryAfter;
    throw err;
  }
  return data;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  await getAuthMode();
  const headers: Record<string, string> = { ...(options.headers || {}) };

  let body = options.body;
  // 非 FormData 的 body 统一 JSON 序列化
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const opts: RequestInit = {
    method: options.method,
    headers,
    credentials: 'same-origin',
    body: body as BodyInit | undefined
  };

  const res = await fetch(path, opts);
  const data = (await res.json().catch(() => ({}))) as ApiEnvelope;
  // 任意接口 401：凭证失效 → 按模式处理（不做重试循环）
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('未登录或登录已过期');
  }
  if (!res.ok) {
    const err: ApiError = new Error(data.error || `HTTP ${res.status}`);
    err.code = data.code; // 附带给业务用的错误码（如 totp_setup_required / rate_limited）
    err.status = res.status;
    err.retryAfter = data.retryAfter; // 429 限速剩余秒数
    throw err;
  }
  return data as unknown as T;
}

/* ============ 类型（请求体 / 响应体真实形状） ============ */

/** TOTP 设置/重置返回：密钥与 otpauth URI */
export interface TotpSetupResult {
  secret: string;
  otpauthUri: string;
  expiresIn?: number;
}

/** 单核占用 */
export interface CoreUsage {
  id?: number | string;
  usage_percent?: number | string;
}

/** 磁盘占用 */
export interface DiskInfo {
  mount?: string;
  used?: number;
  total?: number;
  free?: number;
  percent?: number;
}

/** PSI 单档（some / full）的 avg10 等 */
export interface PsiEntry {
  avg10?: number | string;
  avg60?: number | string;
  avg300?: number | string;
  total?: number | string;
}

export interface PsiInfo {
  some?: PsiEntry;
  full?: PsiEntry;
}

export interface CpuInfo {
  usage_percent?: number;
  per_core?: CoreUsage[];
  model?: string;
  cores?: number;
  loadavg?: number[] | string | null;
}

export interface MemoryInfo {
  percent?: number;
  used?: number;
  available?: number;
  buffCache?: number;
  free?: number;
  total?: number;
  swapTotal?: number;
  swapUsed?: number;
  swapFree?: number;
  swapPercent?: number;
  zram?: { used?: number; total?: number } | null;
}

export interface NetworkInfo {
  rx_rate?: number;
  tx_rate?: number;
  rx_bytes?: number;
  tx_bytes?: number;
}

export interface DiskIoInfo {
  read_rate?: number;
  write_rate?: number;
  read_bytes?: number;
  write_bytes?: number;
}

/** 进程数量摘要（running / total） */
export interface ProcessCount {
  running?: number;
  total?: number;
}

/** /api/admin/system 快照（SSE snapshot 的 system 段同构） */
export interface SystemData {
  cpu?: CpuInfo;
  memory?: MemoryInfo;
  disk?: DiskInfo | null;
  disks?: DiskInfo[];
  network?: NetworkInfo | null;
  disk_io?: DiskIoInfo | null;
  processes?: ProcessCount | null;
  psi?: { memory?: PsiInfo; cpu?: PsiInfo; io?: PsiInfo };
  uptime?: number | string;
  os?: string;
  hostname?: string;
}

/** 历史采样点（各图表按 key 取列，故保留数字索引签名） */
export interface HistoryPoint {
  ts: number;
  [key: string]: number | undefined;
}

/** 服务状态项（进程排行左侧状态点按 pid 关联） */
export interface ServiceInfo {
  pid?: number;
  name?: string;
  status?: string;
}

/** 粒度聚合历史（趋势图分钟/小时/天档） */
export interface SystemMetricsResponse {
  step?: string;
  range?: string;
  points?: HistoryPoint[];
  meta?: { recordedSeconds?: number; [key: string]: unknown };
}

/** 应用面板单项 */
export interface AppInfo {
  id: string;
  name: string;
  icon?: string;
  desc?: string;
  url?: string;
  status: string;
  category?: string;
  port?: number | string | null;
  latencyMs?: number | string | null;
}

export interface AppCategory {
  id: string;
  name: string;
}

/** 未登记监听项 */
export interface DiscoveredApp {
  port?: number | string | null;
  process?: string;
}

export interface AppsResponse {
  apps?: AppInfo[];
  categories?: AppCategory[];
  discovered?: DiscoveredApp[];
  generatedAt?: string | number;
  cached?: boolean;
  notice?: string;
}

export interface VersionInfo {
  name: string;
  category?: string;
  version?: string;
  ok?: boolean;
}

/** 博客文章（后台列表 / 详情） */
export interface BlogPost {
  id: number;
  title: string;
  subtitle?: string;
  slug: string;
  public_id?: string;
  tags?: string[];
  excerpt?: string;
  content?: string;
  published?: boolean;
  collection?: { id: number; name: string } | null;
  collection_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

/** 新建 / 更新文章请求体 */
export interface BlogPostInput {
  title: string;
  subtitle: string;
  slug: string;
  tags: string[];
  excerpt: string;
  content: string;
  published: boolean;
  /** 合集 id：表单下拉给字符串，直接透传后端 */
  collection_id: number | string | null;
}

/** 博客合集 */
export interface BlogCollection {
  id: number;
  name: string;
  slug: string;
  public_id?: string;
  description?: string;
  post_count?: number;
}

export interface BlogCollectionInput {
  name: string;
  slug: string;
  description: string;
}

/** 已登录设备会话 */
export interface SessionInfo {
  id: string;
  deviceName?: string;
  isCurrent?: boolean;
  userAgent?: string;
  ip?: string;
  isLocal?: boolean;
  location?: string;
  createdAt?: number;
  lastSeenAt?: number;
  expiresAt: number;
}

/** 接口令牌（绝不含明文） */
export interface ApiToken {
  id: string;
  name: string;
  note?: string;
  canWrite?: boolean;
  createdAt?: number;
  expiresAt: number;
  lastUsedAt?: number;
}

export interface CreateApiTokenInput {
  name: string;
  note: string;
  expiresInDays: number;
  canWrite: boolean;
}

export interface UpdateApiTokenInput {
  name?: string;
  note?: string;
  expiresInDays?: number;
  canWrite?: boolean;
}

/** 文件区目录项 */
export interface FileEntry {
  name: string;
  type: 'dir' | 'file';
  size: number;
  mtime: number;
}

export interface DirListing {
  path?: string;
  parent?: string;
  entries?: FileEntry[];
}

/** 文件临时链接（下载分享） */
export interface FileShare {
  id: string;
  relPath: string;
  url: string;
  status: 'active' | 'expired' | 'revoked';
  expiresAt: number;
  createdAt: number;
  remainingMs: number;
  downloads?: number;
  fileExists?: boolean;
  note?: string;
  revokedAt?: number;
}

/** 创建 / 改期接口按约定返回 share 本体；历史实现也兼容 { share } 包裹，故同时允许 share 字段。 */
export type FileShareResponse = FileShare & { share?: FileShare };

/** 列表接口按约定返回 { shares }；历史实现也兼容裸数组。 */
export type FileShareList = FileShare[] & { shares?: FileShare[] };

export interface FileShareCreateBody {
  expiresAt?: number;
  ttlHours?: number;
  note?: string;
}

export interface FileSharePatch {
  expiresAt?: number;
  note?: string;
  revoked?: boolean;
}

/** 上传进度回调载荷 */
export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadHandlers {
  onProgress?: (p: UploadProgress) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (e: Error) => void;
}

/** 通知条目（ts / readAt 为 epoch 秒） */
export interface NotificationItem {
  id: number;
  title: string;
  ts?: number;
  level?: string;
  source?: string;
  type?: string;
  body?: string;
  link?: string;
  readAt?: number | null;
  dedupKey?: string;
}

export interface NotificationParams {
  limit?: number;
  before?: number | string;
  level?: string;
  source?: string;
  type?: string;
  unread?: boolean;
}

export interface NotificationListResponse {
  items?: NotificationItem[];
  unread: number;
  total?: number;
}

/** 服务端定义的通知类别 */
export interface NotificationType {
  key: string;
  label?: string;
  description?: string;
  defaultLevel?: string;
  sort?: number;
  enabled?: number;
  count?: number;
  unread?: number;
}

export interface NotificationStats {
  total?: number;
  unread?: number;
  sources?: { source: string; count: number }[];
}

export interface NotificationPayload {
  level?: string;
  source?: string;
  title?: string;
  body?: string;
  link?: string;
  dedupKey?: string;
}

export interface BulkDeleteFilters {
  level?: string;
  source?: string;
  unreadOnly?: boolean;
  readOnly?: boolean;
  dryRun?: boolean;
}

/* ============ 系统 ============ */

// TOTP 首次设置（仅未配置时可用），返回 { secret, otpauthUri }
export function totpSetup(): Promise<TotpSetupResult> {
  return request<TotpSetupResult>('/api/admin/totp/setup', { method: 'POST' });
}

// TOTP 重置第一阶段（需已登录）：生成 pending secret，返回 { secret, otpauthUri, expiresIn }
export function totpReset(): Promise<TotpSetupResult> {
  return request<TotpSetupResult>('/api/admin/totp/reset', { method: 'POST' });
}

// TOTP 重置第二阶段（需已登录）：用 pending secret 生成的新验证码确认转正
export function totpResetConfirm(code: string): Promise<unknown> {
  return request('/api/admin/totp/confirm', { method: 'POST', body: { code } });
}

// 系统信息
export function getSystem(): Promise<SystemData> {
  return request<SystemData>('/api/admin/system');
}

// 历史采样（趋势图数据）
export function getSystemHistory(): Promise<HistoryPoint[]> {
  return request<HistoryPoint[]>('/api/admin/system/history');
}

// 粒度聚合历史（趋势图切换分钟/小时/天档位时使用）
// 返回 { step, range, points: [{ ts, cpu, mem_percent, ... }] }（points 与 /history 同构）
export function getSystemMetrics(range: string, step: string): Promise<SystemMetricsResponse> {
  return request<SystemMetricsResponse>(
    `/api/admin/system/metrics?range=${encodeURIComponent(range)}&step=${encodeURIComponent(step)}`
  );
}

// 服务状态列表
export function getServices(): Promise<ServiceInfo[]> {
  return request<ServiceInfo[]>('/api/admin/services');
}

// 应用面板（只读）：返回 { apps, categories, discovered, generatedAt, cached, notice, ... }
// refresh=true 时带 refresh=1 绕过后端 10s 缓存；卡片 url 直接用返回值，前端不拼域名。
export function getApps({ refresh = false }: { refresh?: boolean } = {}): Promise<AppsResponse> {
  return request<AppsResponse>(`/api/admin/apps${refresh ? '?refresh=1' : ''}`);
}

// 软件版本监控（仅本地当前版本，秒回）
export function getVersions(): Promise<{ list?: VersionInfo[] }> {
  return request('/api/admin/versions');
}

// 上传文件，返回 { path: 绝对路径 }
export function uploadFile(file: File): Promise<{ path: string }> {
  const fd = new FormData();
  fd.append('file', file);
  return request('/api/admin/upload', { method: 'POST', body: fd });
}

// 修改密码
export function changePassword(old_password: string, new_password: string): Promise<unknown> {
  return request('/api/admin/password', {
    method: 'POST',
    body: { old_password, new_password }
  });
}

// 上传博客图片，返回 { url }
export function uploadBlogImage(file: File): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append('image', file);
  return request('/api/blog/admin/upload', { method: 'POST', body: fd });
}
export function downloadUrl(filePath: string): string {
  return `/api/admin/download?path=${encodeURIComponent(filePath)}`;
}

// ============ 博客接口 ============
// 管理接口带 Admin token（blog-server 双通道认证：blog JWT 或 Admin Redis 会话）

// 公开文章列表（仅已发布，返回 { list, total, totalPages, ... }）
export function getBlogPosts(): Promise<{ list?: BlogPost[]; total?: number; totalPages?: number }> {
  return request('/api/blog/posts');
}

// 公开文章详情
export function getBlogPost(slug: string): Promise<BlogPost> {
  return request<BlogPost>(`/api/blog/posts/${slug}`);
}

// 全部文章（含草稿与正文，需鉴权）
export function getBlogAdminPosts(): Promise<{ list?: BlogPost[] }> {
  return request('/api/blog/admin/posts');
}

// 新建文章（需鉴权），data: { title, slug, tags, excerpt, content, published }
export function createBlogPost(data: BlogPostInput): Promise<unknown> {
  return request('/api/blog/admin/posts', { method: 'POST', body: data });
}

// 更新文章（需鉴权）
export function updateBlogPost(id: number, data: BlogPostInput): Promise<unknown> {
  return request(`/api/blog/admin/posts/${id}`, { method: 'PUT', body: data });
}

// 删除文章（需鉴权）
export function deleteBlogPost(id: number): Promise<unknown> {
  return request(`/api/blog/admin/posts/${id}`, { method: 'DELETE' });
}

// 取「打开文章页」地址（需鉴权）：已发布回公开地址，草稿附短时效预览令牌
export function getBlogPostPreviewLink(id: number): Promise<{ url: string }> {
  return request<{ url: string }>(`/api/blog/admin/posts/${id}/preview-link`);
}

// ---------- 合集接口 ----------

// 公开合集列表（仅已发布文章数，返回 { list }）
export function getBlogCollections(): Promise<{ list?: BlogCollection[] }> {
  return request('/api/blog/collections');
}

// 公开合集详情（按 slug）
export function getBlogCollection(slug: string): Promise<BlogCollection> {
  return request<BlogCollection>(`/api/blog/collections/${encodeURIComponent(slug)}`);
}

// 全部合集（含草稿文章数，需鉴权）
export function getBlogAdminCollections(): Promise<{ list?: BlogCollection[] }> {
  return request('/api/blog/admin/collections');
}

// 新建合集（需鉴权），data: { name, slug, description }
export function createBlogCollection(data: BlogCollectionInput): Promise<unknown> {
  return request('/api/blog/admin/collections', { method: 'POST', body: data });
}

// 更新合集（需鉴权）
export function updateBlogCollection(id: number, data: BlogCollectionInput): Promise<unknown> {
  return request(`/api/blog/admin/collections/${id}`, { method: 'PUT', body: data });
}

// 删除合集（需鉴权，文章 collection_id 置 NULL）
export function deleteBlogCollection(id: number): Promise<unknown> {
  return request(`/api/blog/admin/collections/${id}`, { method: 'DELETE' });
}

// ============ 设备会话管理 ============

// 已登录设备列表（需鉴权），返回 { sessions: [...] }
export function getSessions(): Promise<{ sessions?: SessionInfo[] }> {
  return request('/api/admin/sessions');
}

// 重命名设备，id 为会话 token
export function renameSession(id: string, deviceName: string): Promise<unknown> {
  return request(`/api/admin/sessions/${id}/name`, { method: 'PUT', body: { deviceName } });
}

// 删除设备会话（撤销其登录凭证，该设备必须重新认证）
export function deleteSession(id: string): Promise<unknown> {
  return request(`/api/admin/sessions/${id}`, { method: 'DELETE' });
}

// ============ 接口令牌管理（与登录设备完全隔离） ============

// 接口令牌列表，返回 { tokens: [...] }（绝不含 token 明文）
export function getApiTokens(): Promise<{ tokens?: ApiToken[] }> {
  return request('/api/admin/api-tokens');
}

// 生成接口令牌，data: { name, note, expiresInDays }，返回 { id, token, meta }（明文仅此一次）
export function createApiToken(
  data: CreateApiTokenInput
): Promise<{ id?: string; token: string; meta?: ApiToken }> {
  return request('/api/admin/api-tokens', { method: 'POST', body: data });
}

// 更新接口令牌，patch 可选 { name, note, expiresInDays }
export function updateApiToken(id: string, patch: UpdateApiTokenInput): Promise<unknown> {
  return request(`/api/admin/api-tokens/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

// 吊销接口令牌（立即失效）
export function deleteApiToken(id: string): Promise<unknown> {
  return request(`/api/admin/api-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ============ 历史会话浏览（只读） ============

// 历史会话列表，返回 { sessions: [{ id, title, time, message_count }] }
export function getHistorySessions(): Promise<{
  sessions?: {
    id: string;
    title?: string;
    time?: number | string;
    message_count?: number;
  }[];
}> {
  return request('/api/admin/history');
}

// 单个历史会话消息，返回 { session: { id, title }, messages: [{ role, content, ts }] }
export function getHistoryMessages(id: string): Promise<{
  session?: { id: string; title?: string };
  messages?: { role?: string; content?: string; ts?: number | string }[];
}> {
  return request('/api/admin/history/' + encodeURIComponent(id));
}

// ============ 文件区（目录浏览 / 上传 / 下载 / 新建 / 重命名 / 删除） ============
// path 均为相对文件区根目录的路径，根目录为 ''（后端做越界校验）

// 列目录，返回 { path, parent, entries: [{ name, type: 'dir'|'file', size, mtime }] }
export function listFiles(path = ''): Promise<DirListing> {
  return request<DirListing>(`/api/admin/files?path=${encodeURIComponent(path)}`);
}

// 新建文件夹
export function makeDir(path: string, name: string): Promise<unknown> {
  return request('/api/admin/files/mkdir', { method: 'POST', body: { path, name } });
}

// 重命名文件或目录（path 为完整相对路径，name 为新名称）
export function renameEntry(path: string, name: string): Promise<unknown> {
  return request('/api/admin/files/rename', { method: 'POST', body: { path, name } });
}

// 删除文件或目录（目录递归）
export function deleteEntry(path: string): Promise<unknown> {
  return request(`/api/admin/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

// 下载地址：<a>/window.open 无法带自定义头。身份由同源会话 cookie 证明，
// 路径里不再拼 token（网关会剥掉客户端伪造的凭证头，cookie 已在同源请求里）。
export function fileDownloadUrl(path: string): string {
  return `/api/admin/files/download?path=${encodeURIComponent(path)}`;
}

// 上传单个文件（必须用 XHR：fetch 拿不到上传进度）
// onProgress({ loaded, total, percent }) · onDone(data) · onError(err)；返回 xhr 供调用方 abort()
export function uploadFileTo(
  path: string,
  file: File,
  { onProgress, onDone, onError }: UploadHandlers = {}
): XMLHttpRequest {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/admin/files/upload?path=${encodeURIComponent(path)}`);
  xhr.withCredentials = true; // 同源会话 cookie

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
    let data: ApiEnvelope = {};
    try {
      data = JSON.parse(xhr.responseText || '{}');
    } catch (e) {
      data = {};
    }
    if (xhr.status === 401) {
      handleUnauthorized(); // 凭证失效：按模式回登录页 / 跳网关
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
export function createFileShare(
  path: string,
  data: FileShareCreateBody = {}
): Promise<FileShareResponse> {
  return request<FileShareResponse>('/api/admin/files/shares', {
    method: 'POST',
    body: { path, ...data }
  });
}

// 临时链接列表（按 createdAt 倒序），返回 { shares: [...] }
// 每项含计算字段：url / status / remainingMs / fileExists
export function listFileShares(): Promise<FileShareList> {
  return request<FileShareList>('/api/admin/files/shares');
}

// 改期 / 转永久（expiresAt: 0）/ 改备注 / 撤销（revoked: true，不可逆）
export function updateFileShare(id: string, patch: FileSharePatch): Promise<FileShareResponse> {
  return request<FileShareResponse>(`/api/admin/files/shares/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch
  });
}

// 删除链接记录（不动磁盘文件）
export function deleteFileShare(id: string): Promise<unknown> {
  return request(`/api/admin/files/shares/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

// ============ 通知中心 ============
// 返回 { items: [{ id, ts, level, source, type, title, body, link, readAt }], unread, total }
// ts / readAt 为 epoch 秒。params: { limit, before, level, source, type, unread }
export function getNotifications(params: NotificationParams = {}): Promise<NotificationListResponse> {
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
export function getNotificationTypes(): Promise<{ types?: NotificationType[] }> {
  return request('/api/admin/notifications/types');
}

// 单条已读
export function markNotificationRead(id: number): Promise<unknown> {
  return request(`/api/admin/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

// 全部已读，返回 { ok, count }
export function markAllNotificationsRead(): Promise<{ ok?: boolean; count?: number }> {
  return request('/api/admin/notifications/read-all', { method: 'POST' });
}

// 删除
export function deleteNotification(id: number): Promise<unknown> {
  return request(`/api/admin/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// 主动推送一条通知（发通知表单），返回 { id, ts }
export function createNotification(
  payload: NotificationPayload
): Promise<{ id?: number; ts?: number }> {
  return request('/api/admin/notifications', { method: 'POST', body: payload });
}

// 批量删除：filters { level?, source?, unreadOnly?, readOnly?, dryRun? } → { ok, count }
// dryRun=true 只统计不删除（用于二次确认时展示准确条数）
export function bulkDeleteNotifications(
  filters: BulkDeleteFilters = {}
): Promise<{ ok?: boolean; count?: number }> {
  const body: BulkDeleteFilters = {};
  if (filters.level) body.level = filters.level;
  if (filters.source) body.source = filters.source;
  if (filters.unreadOnly) body.unreadOnly = true;
  if (filters.readOnly) body.readOnly = true;
  if (filters.dryRun) body.dryRun = true;
  return request('/api/admin/notifications/bulk-delete', { method: 'POST', body });
}

// 统计 → { total, unread, sources: [{ source, count }] }
export function getNotificationStats(): Promise<NotificationStats> {
  return request<NotificationStats>('/api/admin/notifications/stats');
}
