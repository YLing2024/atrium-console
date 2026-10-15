import { useEffect, useRef, useState } from 'react';
import type { NotificationItem } from './api';

/**
 * 通知「服务器推送」总线与等待器。
 *
 * 铁律（2026-09-21 需求）：新通知只能由服务器 SSE 推送进入列表；发送方（通知管理页 / 调试页）
 * 在 POST 成功后一律不得本地插入、不得主动重拉来让这条出现——那会掩盖实时通道已断的事实。
 * 本模块让发送方「只观察推送是否到达」：
 *   - NotificationCenter / NotificationDebug 的 SSE 收到 event: notification 后 emitNotificationPush(item)；
 *   - 发送方 usePushWait().beginPushWait(target) 匹配 id 得到到达耗时，或 10 秒超时。
 *
 * 为什么要历史缓冲：服务端先 broadcast 再回 HTTP 响应，SSE 帧完全可能在 fetch 的 await 恢复之前
 * 就已到达；beginPushWait 先查「本次发送之后」到达的推送，避免正常路径被误判为超时。
 */

export const NOTIFICATION_PUSH_EVENT = 'admin:notification-push';
export const PUSH_WAIT_MS = 10000;

/** 等待服务器推送的状态机结果 */
export interface PushState {
  phase: 'waiting' | 'received' | 'timeout';
  startedAt: number;
  elapsedMs?: number;
}

/** 匹配目标：优先按 POST 返回的 id，无 id 时用 dedupKey / 标题+来源 */
export interface PushTarget {
  id?: number | null;
  dedupKey?: string;
  title?: string;
  source?: string;
}

const HISTORY_TTL_MS = 15000;
const HISTORY_MAX = 50;

const recentPushes: { item: NotificationItem; at: number }[] = []; // [{ item, at }] 按 at 递增

function prune(now: number): void {
  while (
    recentPushes.length &&
    (now - recentPushes[0].at > HISTORY_TTL_MS || recentPushes.length > HISTORY_MAX)
  ) {
    recentPushes.shift();
  }
}

// SSE 收到推送时调用：缓冲最近推送并广播给等待方
export function emitNotificationPush(item: NotificationItem | null | undefined): void {
  if (!item || item.id == null) return;
  const now = Date.now();
  recentPushes.push({ item, at: now });
  prune(now);
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_PUSH_EVENT, { detail: item }));
  } catch (e) {
    // 自定义事件不可用：历史缓冲仍可供 beginPushWait 命中
  }
}

export function onNotificationPush(handler: (item: NotificationItem) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<NotificationItem>).detail);
  window.addEventListener(NOTIFICATION_PUSH_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATION_PUSH_EVENT, listener);
}

// sinceTs：只接受该时刻之后到达的推送（过滤同 id 去重更新的历史推送）
export function findRecentPush(
  predicate: (item: NotificationItem) => boolean,
  sinceTs = 0
): NotificationItem | null {
  const now = Date.now();
  prune(now);
  for (let i = recentPushes.length - 1; i >= 0; i--) {
    const entry = recentPushes[i];
    if (entry.at >= sinceTs && predicate(entry.item)) return entry.item;
  }
  return null;
}

// 优先按 POST 返回的 id 匹配；无 id 时退化为 dedupKey / 标题+来源
export function pushMatches(item: NotificationItem | null, target: PushTarget | null): boolean {
  if (!item || !target) return false;
  if (target.id != null && item.id != null) return Number(item.id) === Number(target.id);
  if (target.dedupKey && item.dedupKey) return item.dedupKey === target.dedupKey;
  if (!target.title) return false;
  return item.title === target.title && (!target.source || item.source === target.source);
}

/**
 * 发一条通知后等待服务器推送的状态机。
 * pushState: null | { phase: 'waiting' | 'received' | 'timeout', startedAt, elapsedMs? }
 * startedAt 传「点击发送」的时刻，以便耗时是端到端的实际等待时间。
 */
export function usePushWait(): {
  pushState: PushState | null;
  beginPushWait: (target: PushTarget, startedAt?: number) => void;
  markWaiting: (startedAt?: number) => number;
  resetPushWait: () => void;
  cancelPushWait: () => void;
} {
  const [pushState, setPushState] = useState<PushState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  function clear(): void {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
  }

  // 提交瞬间调用：保证「等待推送」指示在 POST 往返期间必定渲染（随后 beginPushWait 续接）
  function markWaiting(startedAt = Date.now()): number {
    clear();
    setPushState({ phase: 'waiting', startedAt });
    return startedAt;
  }

  function beginPushWait(target: PushTarget, startedAt = Date.now()): void {
    clear();
    setPushState({ phase: 'waiting', startedAt });
    const t = Number.isFinite(startedAt) ? startedAt : Date.now();

    const existing = findRecentPush((item) => pushMatches(item, target), t);
    if (existing) {
      clear();
      setPushState({ phase: 'received', startedAt: t, elapsedMs: Math.max(0, Date.now() - t) });
      return;
    }

    unsubRef.current = onNotificationPush((item) => {
      if (!pushMatches(item, target)) return;
      clear();
      setPushState({ phase: 'received', startedAt: t, elapsedMs: Math.max(0, Date.now() - t) });
    });
    timerRef.current = setTimeout(() => {
      clear();
      setPushState({ phase: 'timeout', startedAt: t });
    }, PUSH_WAIT_MS);
  }

  // 卸载时清掉定时器与订阅
  useEffect(() => {
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetPushWait(): void {
    clear();
    setPushState(null);
  }

  return { pushState, beginPushWait, markWaiting, resetPushWait, cancelPushWait: clear };
}
