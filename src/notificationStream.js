import { useEffect, useRef, useState } from 'react';
import { emitNotificationPush } from './notificationPush.js';
import { getToken } from './api.js';

/**
 * 通知 SSE 长连接（全站单例，原生 fetch + ReadableStream，无第三方依赖）。
 *
 * 为什么不用原生 EventSource：EventSource 不能携带 Authorization 头，而本项目
 * 走 nginx `auth_request` + Bearer token，因此沿用 fetch 流自行管理连接；
 * 也正因为自管，原生 EventSource「自动重连但不告知连接已死」的问题不存在。
 *
 * 看门狗（本模块的核心）：
 *   - 连接建立（HTTP 200 + 首个字节）即视为「已连接」，开始计时；
 *   - 收到 notification / heartbeat 事件都重置计时；
 *   - 超过 WATCHDOG_MS(90s) 无任何事件 → 主动 abort 当前连接，按退避重连，
 *     绝不让界面停在「已连接」假装还连着。
 * 退避：1s→2s→4s→8s→…→60s 上限；收到事件（通道确认活着）后重置。
 * 重连成功（再次握手）后触发一次 resync，让页面补齐断线期间漏掉的数据。
 *
 * 状态：connected | reconnecting | disconnected（未鉴权/已停止，不再重试）。
 * 不允许乐观更新：本模块只负责「推送 / 状态 / 重连通知」，不碰列表数据。
 */

export const NOTIFICATION_STREAM_PATH = '/api/admin/notifications/stream';
export const WATCHDOG_MS = 90000; // 90s 无事件判死
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60000;

let refCount = 0;
let running = false;
let connection = null; // { ctrl, aborted }
let retryTimer = null;
let watchdogTimer = null;
let attempt = 0;
let nextRetryAt = 0;
let openedOnce = false; // 是否已成功握手过（区分首次连接与重连）
let lastSignalAt = 0; // 握手或任一事件
let lastEventAt = 0; // notification
let lastHeartbeatAt = 0; // heartbeat
let status = 'disconnected';

const stateListeners = new Set();
const notificationListeners = new Set();
const resyncListeners = new Set();

function snapshot() {
  return { status, attempt, nextRetryAt, lastSignalAt, lastEventAt, lastHeartbeatAt };
}

export function getNotificationStreamState() {
  return snapshot();
}

function publish() {
  const s = snapshot();
  stateListeners.forEach((fn) => {
    try {
      fn(s);
    } catch (e) {
      // 单个订阅者异常不影响连接
    }
  });
}

function setStatus(next) {
  if (status === next) return;
  status = next;
  publish();
}

function armWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(onWatchdog, WATCHDOG_MS);
}

function disarmWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function closeConnection() {
  const c = connection;
  connection = null;
  if (!c) return;
  c.aborted = true;
  try {
    c.ctrl.abort();
  } catch (e) {
    // 已关闭
  }
}

function notifyResync() {
  resyncListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      // 忽略
    }
  });
}

// 连接建立：进入已连接；若是重连则通知页面补齐数据
function onHandshake() {
  lastSignalAt = Date.now();
  nextRetryAt = 0;
  armWatchdog();
  const reconnected = openedOnce;
  openedOnce = true;
  setStatus('connected');
  publish();
  if (reconnected) notifyResync();
}

// 收到事件（notification / heartbeat）：重置看门狗与退避
function onEvent(kind) {
  const t = Date.now();
  lastSignalAt = t;
  if (kind === 'notification') lastEventAt = t;
  else lastHeartbeatAt = t;
  attempt = 0;
  nextRetryAt = 0;
  armWatchdog();
  publish();
}

function scheduleRetry() {
  if (!running) return;
  attempt += 1;
  const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
  nextRetryAt = Date.now() + delay;
  setStatus('reconnecting');
  publish();
  clearRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, delay);
}

// 90s 无任何事件：主动断开并重连（不允许界面假装还连着）
function onWatchdog() {
  watchdogTimer = null;
  if (!running) return;
  closeConnection();
  disarmWatchdog();
  scheduleRetry();
}

function handleFrame(frame) {
  let event = null;
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!event) return; // retry / 注释行不算事件
  if (event === 'heartbeat') {
    onEvent('heartbeat');
    return;
  }
  if (event === 'notification') {
    let item;
    try {
      item = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (!item || item.id == null) return;
    onEvent('notification');
    // 推送给「等待推送」的发送方（只观察，不插入）
    emitNotificationPush(item);
    notificationListeners.forEach((fn) => {
      try {
        fn(item);
      } catch (e) {
        // 忽略
      }
    });
  }
}

async function connect() {
  if (!running || connection) return;
  clearRetry();
  const my = { ctrl: new AbortController(), aborted: false };
  connection = my;
  try {
    const resp = await fetch(NOTIFICATION_STREAM_PATH, {
      headers: { Authorization: 'Bearer ' + getToken() },
      signal: my.ctrl.signal
    });
    if (my.aborted || !running || connection !== my) return;
    if (resp.status === 401 || resp.status === 403) {
      // 凭证失效：重试无意义，停在这里（其余接口的 401 会统一跳 SSO）
      connection = null;
      disarmWatchdog();
      setStatus('disconnected');
      publish();
      return;
    }
    if (!resp.ok || !resp.body) throw new Error('SSE HTTP ' + resp.status);

    onHandshake();
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (running && !my.aborted && connection === my) {
      const { done, value } = await reader.read();
      if (my.aborted || !running || connection !== my) return;
      if (done) break;
      if (value && value.length) {
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (frame) handleFrame(frame);
        }
      }
    }
  } catch (e) {
    if (my.aborted || !running || connection !== my) return;
  }
  if (my.aborted || !running || connection !== my) return;
  // 流结束 / 出错：进入退避重连
  connection = null;
  disarmWatchdog();
  scheduleRetry();
}

function start() {
  if (running) return;
  running = true;
  attempt = 0;
  nextRetryAt = 0;
  openedOnce = false;
  lastSignalAt = 0;
  lastEventAt = 0;
  lastHeartbeatAt = 0;
  status = 'reconnecting'; // 首次连接中
  publish();
  connect();
}

function stop() {
  running = false;
  clearRetry();
  disarmWatchdog();
  closeConnection();
  attempt = 0;
  nextRetryAt = 0;
  openedOnce = false;
  lastSignalAt = 0;
  lastEventAt = 0;
  lastHeartbeatAt = 0;
  status = 'disconnected';
  publish();
}

/**
 * 订阅单例连接。handlers: { onState, onNotification, onResync }。
 * 首个订阅者负责建立连接；最后一个退订时断开。
 */
export function subscribeNotificationStream(handlers = {}) {
  const { onState, onNotification, onResync } = handlers;
  if (onState) stateListeners.add(onState);
  if (onNotification) notificationListeners.add(onNotification);
  if (onResync) resyncListeners.add(onResync);
  refCount += 1;
  if (refCount === 1) start();
  if (onState) onState(snapshot());
  return () => {
    if (onState) stateListeners.delete(onState);
    if (onNotification) notificationListeners.delete(onNotification);
    if (onResync) resyncListeners.delete(onResync);
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) stop();
  };
}

// React 绑定：组件只读状态，回调经 ref 保持最新
export function useNotificationStream(handlers = {}) {
  const [state, setState] = useState(getNotificationStreamState);
  const notificationRef = useRef(handlers.onNotification);
  const resyncRef = useRef(handlers.onResync);
  notificationRef.current = handlers.onNotification;
  resyncRef.current = handlers.onResync;

  useEffect(() => {
    return subscribeNotificationStream({
      onState: setState,
      onNotification: (item) => {
        if (notificationRef.current) notificationRef.current(item);
      },
      onResync: () => {
        if (resyncRef.current) resyncRef.current();
      }
    });
  }, []);

  return state;
}

// 状态文案（调试页 / 通知页共用）。nowMs 由调用方的秒级 tick 传入以显示倒计时。
export function notificationStreamLabel(s, nowMs = Date.now()) {
  if (s.status === 'connected') return '已连接';
  if (s.status === 'disconnected') return '已断开';
  if (s.attempt > 0) {
    const remain =
      s.nextRetryAt > nowMs ? Math.max(1, Math.ceil((s.nextRetryAt - nowMs) / 1000)) : 0;
    return remain > 0
      ? `重连中（第 ${s.attempt} 次，下次 ${remain} 秒）`
      : `重连中（第 ${s.attempt} 次，正在连接）`;
  }
  return '连接中…';
}
