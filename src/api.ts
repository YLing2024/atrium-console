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

/** fetch 因网络不可达而 reject（区别于服务器返回的 HTTP 4xx/5xx 响应）。 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

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
  /** 供调用方（如系统 Tab 切走）立即中止请求 */
  signal?: AbortSignal;
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
    signal: options.signal,
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

/** 磁盘占用与按盘 I/O */
export interface DiskInfo {
  mount?: string;
  filesystem?: string;
  /** 基础设备名（与 /proc/diskstats 对齐，如 vda / nvme0n1） */
  device?: string;
  used?: number;
  total?: number;
  free?: number;
  percent?: number;
  /** 该设备读速率（字节/秒） */
  read_rate?: number;
  /** 该设备写速率（字节/秒） */
  write_rate?: number;
  /** 该设备累计读字节 */
  read_bytes?: number;
  /** 该设备累计写字节 */
  write_bytes?: number;
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

/** 进程树单行（`GET /api/admin/services` 的 processes 项；subtree_* 为该节点含全部后代的和） */
export interface ProcessInfo {
  name: string;
  pid: number;
  ppid?: number;
  mem_mb?: number;
  cpu?: number;
  subtree_mem_mb?: number;
  subtree_cpu?: number;
  /** 含自身的后代进程数（服务端算好，前端不再自己数） */
  subtree_count?: number;
  /** 该行是 systemd 单位主进程时该单位 cgroup 真值（MB，含页缓存）；否则 null */
  cgroup_mem_mb?: number | null;
  /** 该进程线程数（读 /proc/<pid>/task）；进程已退出/读不到为 null */
  thread_count?: number | null;
}

/** 服务状态 + 全量进程树（`GET /api/admin/services`） */
export interface ServicesResponse {
  services?: ServiceInfo[];
  processes?: ProcessInfo[];
  /** 解析到的进程总数（截断前） */
  count?: number;
  truncated?: boolean;
  /** 全部进程 RSS 之和（MB）；含共享内存重复计算，字段名如实表达 */
  total_mem_mb?: number;
  /** 系统总占用（不是列表之和） */
  total_cpu?: number;
  /** ps 输出成功解析的行数 */
  parsed_count?: number;
  /** 解析失败被丢弃的行数（>0 时界面需提示） */
  skipped_count?: number;
  /** system.slice 的 cgroup 真值（MB，含页缓存）；取不到为 null */
  total_cgroup_mb?: number | null;
  /** 全部进程线程数之和（截断前口径）；与 count 为两个口径，不得混算 */
  total_threads?: number;
}

/** 粒度聚合历史（趋势图分钟/小时/天档） */
export interface SystemMetricsResponse {
  step?: string;
  range?: string;
  points?: HistoryPoint[];
  meta?: { recordedSeconds?: number; [key: string]: unknown };
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

// 服务状态 + 全量进程树（含子树合计）。signal 供系统 Tab 切走时立即中止请求。
// 返回 { services, processes, count, truncated, total_mem_mb, total_cpu }。
export function getServices(opts: { signal?: AbortSignal } = {}): Promise<ServicesResponse> {
  return request<ServicesResponse>('/api/admin/services', { signal: opts.signal });
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
