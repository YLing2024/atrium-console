/**
 * WebSocket 客户端：连接 /api/admin/ws（同源、query 携带认证中心 token，key: auth_token）
 * 封装 JSON-RPC 2.0 请求/响应 与 服务端事件流。
 *
 * 帧协议（与 Hermes 网关一致，经 admin-server 透传）：
 *  - 请求:   { jsonrpc, id, method, params }
 *  - 响应:   { jsonrpc, id, result } / { jsonrpc, id, error }
 *  - 事件:   { method, params }  例如 gateway.ready / message.start / message.delta / message.done
 *
 * 心跳保活：连接打开后每 25s 发一条 JSON-RPC ping，网关即使不认识该方法也会回 error，
 * 错误响应也是响应，能证明连接存活。ping 10s 无回包 / 距上次收到任意帧超 60s 即判定
 * 连接死亡，主动 close 走现有 onclose 重连逻辑（半开连接可被检测到）。
 */

import { getToken, clearToken, redirectToSso } from './api.js';

const HEARTBEAT_INTERVAL = 25000; // 心跳发送间隔
const HEARTBEAT_TIMEOUT = 10000; // 心跳 RPC 超时（网关对未知方法也会回 error）
const STALE_LIMIT = 60000; // 距上次收到任意帧超过该时长判定死亡
const RECONNECT_BASE = 2000; // 重连退避基数
const RECONNECT_MAX = 30000; // 重连退避封顶

let ws = null;
let connecting = null;
let nextId = 1;
let closedByUser = false;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_BASE; // 当前退避值（重连成功后重置）

let heartbeatTimer = null; // setInterval 回退方案（Worker 不可用时）
let heartbeatWorker = null; // Worker 定时器（不受页面隐藏节流）
let lastMessageAt = 0; // 最近收到任意 WS 帧的时刻

const pending = new Map(); // id -> { resolve, reject, timer }
let listeners = []; // 事件订阅者
let closeListeners = [];
let openListeners = []; // 连接建立（含重连成功）通知
let eventBuffer = []; // 订阅前到达的事件先缓存，避免 gateway.ready 丢失

function getUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/admin/ws?token=${encodeURIComponent(getToken() || '')}`;
}

function emit(msg) {
  if (listeners.length) {
    listeners.forEach((fn) => fn(msg));
  } else {
    eventBuffer.push(msg);
    if (eventBuffer.length > 500) eventBuffer.shift();
  }
}

function rejectAll(reason) {
  pending.forEach((p) => {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  });
  pending.clear();
}

/* ---------- 心跳 ---------- */

function startHeartbeat() {
  stopHeartbeat();
  lastMessageAt = Date.now();
  // 优先用 Worker 承载心跳定时器：页面切出屏幕后主线程 setInterval 会被浏览器节流，
  // Worker 定时器不受影响；Worker 不可用时回退主线程 setInterval。
  if (typeof Worker !== 'undefined') {
    let worker;
    try {
      worker = new Worker(new URL('./heartbeat-worker.js', import.meta.url));
    } catch {
      worker = null; // Worker 不可用：走 setInterval 回退
    }
    if (worker) {
      heartbeatWorker = worker;
      worker.onmessage = (e) => {
        if (e.data === 'tick') sendHeartbeat();
      };
      worker.onerror = () => {
        // Worker 异常：终止并回退主线程 setInterval，不抛错
        if (heartbeatWorker === worker) {
          heartbeatWorker = null;
          try {
            worker.terminate();
          } catch {
            /* 忽略 */
          }
          if (ws && ws.readyState === WebSocket.OPEN) {
            heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
          }
        }
      };
      return;
    }
  }
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatWorker) {
    try {
      heartbeatWorker.terminate();
    } catch {
      /* 忽略 */
    }
    heartbeatWorker = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// 判定连接死亡：主动 close，交由 onclose 统一处理重连
function markDead() {
  stopHeartbeat();
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.close();
    } catch {
      /* 忽略 */
    }
  }
}

function sendHeartbeat() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return; // 连接未 OPEN：跳过本次
  // 背景页 setInterval 会被浏览器节流到约 60s/次，放宽死亡判定，避免误判重连
  const staleLimit =
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
      ? STALE_LIMIT * 3
      : STALE_LIMIT;
  if (lastMessageAt && Date.now() - lastMessageAt > staleLimit) {
    markDead(); // 距最近一次收到任意帧已超限：半开连接，主动断开交给 onclose 重连
    return;
  }
  const id = nextId++;
  const timer = setTimeout(() => {
    // 心跳 RPC 超时无回包（网关对未知方法也会回 error，有回包即活着）→ 判定死亡
    pending.delete(id);
    markDead();
  }, HEARTBEAT_TIMEOUT);
  pending.set(id, { resolve: () => {}, reject: () => {}, timer });
  try {
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping', params: {} }));
  } catch {
    // 发送失败：连接即将关闭，交给 onclose 处理，本次跳过
    pending.delete(id);
    clearTimeout(timer);
  }
}

/* ---------- 连接 ---------- */

// 指数退避重连：2s → 4s → 8s → 16s → 30s 封顶（每次 onclose/首连失败后触发）
function scheduleReconnect() {
  if (closedByUser || !getToken()) return; // 退出登录后不重连
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureConnected().catch(() => {});
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
}

function connect() {
  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      ws = new WebSocket(getUrl());
    } catch (e) {
      scheduleReconnect(); // 同步构造失败同样进入退避重试
      reject(e);
      return;
    }
    ws.onopen = () => {
      closedByUser = false;
      settled = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      reconnectDelay = RECONNECT_BASE; // 重连成功：退避重置
      startHeartbeat();
      resolve();
      openListeners.forEach((fn) => fn());
    };
    ws.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error('WebSocket 连接失败'));
      }
    };
    ws.onmessage = (e) => {
      lastMessageAt = Date.now(); // 收到任意帧（事件/RPC 响应/心跳回包）都算存活
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return; // 忽略非法帧
      }
      if (msg && msg.method) {
        emit(msg); // 事件推送
      } else if (msg && msg.id != null && pending.has(msg.id)) {
        // RPC 响应，id 对应请求 id
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message || msg.error.code || 'RPC 错误'));
        else p.resolve(msg.result);
      }
    };
    ws.onclose = (e) => {
      ws = null;
      connecting = null;
      stopHeartbeat();
      rejectAll('连接已断开');
      closeListeners.forEach((fn) => fn(e));
      if (e.code === 4001) {
        // admin-server 主动关闭 = 凭证无效（认证中心 token 或旧会话均不可用）
        clearToken();
        redirectToSso();
        return;
      }
      // 非主动断开（含首次连接失败）按指数退避重连
      scheduleReconnect();
    };
  });
}

/* ---------- 页面可见性自愈 ---------- */

// 页面从后台切回可见时立即自愈：断线即刻重连 / 在线立即探活，不等退避定时器。
// 监听器在 closeSocket 后仍保留；closedByUser 已置位时 ensureConnected 守卫不误连。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (closedByUser) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendHeartbeat(); // 探活：若连接已半开，ping 无回包会触发 ping 超时 → markDead → onclose → 重连
    } else {
      ensureConnected().catch(() => {}); // 断线即刻重连，不等退避定时器
    }
  });
}

// 确保已连接（幂等）
export function ensureConnected() {
  if (closedByUser) return Promise.reject(new Error('已主动断开')); // 退出登录后不再建立连接
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
  if (!getToken()) return Promise.reject(new Error('未登录'));
  if (connecting) return connecting;
  connecting = connect().catch((e) => {
    connecting = null;
    throw e;
  });
  return connecting;
}

// JSON-RPC 请求
export function rpc(method, params = {}) {
  return ensureConnected().then(() => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('请求超时'));
      }, 60000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  });
}

// 订阅事件流，返回取消订阅函数。订阅时先回放缓存事件。
export function onEvent(fn) {
  listeners.push(fn);
  if (eventBuffer.length) {
    const buf = eventBuffer.splice(0);
    buf.forEach(fn);
  }
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

export function onClose(fn) {
  closeListeners.push(fn);
  return () => {
    closeListeners = closeListeners.filter((f) => f !== fn);
  };
}

// 订阅连接建立（含重连成功）通知，返回取消订阅函数
export function onOpen(fn) {
  openListeners.push(fn);
  return () => {
    openListeners = openListeners.filter((f) => f !== fn);
  };
}

// 主动断开（退出登录时调用）
export function closeSocket() {
  closedByUser = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  stopHeartbeat();
  rejectAll('已主动断开');
  if (ws) {
    try {
      ws.close();
    } catch {
      /* 忽略 */
    }
    ws = null;
  }
}
