// Bitwarden 工具的状态计算纯函数（无 DOM、无副作用），供卡片首次渲染使用。

/** 由 expiresAt（epoch 毫秒）推剩余秒数；列表接口首次渲染时用，缺失返回 null。 */
export function remainingFromExpiresAt(
  expiresAt: number | null | undefined,
  now: number = Date.now()
): number | null {
  if (expiresAt == null || !Number.isFinite(Number(expiresAt))) return null;
  return Math.max(0, Math.floor((Number(expiresAt) - now) / 1000));
}
